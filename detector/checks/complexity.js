'use strict';
// Functions this change made too complex, as each language's own linter measures them: ruff
// for Python, the repository's eslint for JS/TS, golangci-lint (gocyclo, nestif) for Go and
// clippy (cognitive_complexity) for Rust. A linter reports a function on its first line (a
// nested block on its own line), and only lines the change added count: a function that was
// already too complex is not news unless the change wrote that line. A language whose linter is
// missing is skipped and named in the run summary, so it never reads as clean.
const fs = require('fs');
const path = require('path');
const { lang, SNAPSHOT } = require('../files');
const { isGenerated, testCutoff } = require('../code');
const { run, runJson, installed } = require('../proc');

const MAX_FILE = 1024 * 1024;
// Rust unit tests often live in src/tests.rs, which the file kinds do not call a test.
const RUST_TESTS = /(^|\/)tests?\.rs$/;
const PER_FILE = 3;
const HINT = 'split it into named steps or pass an options object';

const RUFF_RULES = 'C901,PLR0912,PLR0913,PLR0915';
// eslint's own defaults for complexity (20) and max-params (3) are far from ruff's; these match
// ruff's mccabe (10) and argument (5) limits so both languages are held to one bar.
const ESLINT_RULES = ['complexity: [warn, 10]', 'max-depth: [warn, 4]', 'max-params: [warn, 5]'];
const ESLINT_IDS = new Set(['complexity', 'max-depth', 'max-params']);
const ESLINT_CONFIG = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'];
// A cold cargo build of a large workspace takes minutes; past this the check fails rather than
// hold the whole run.
const CARGO_MS = 600000;

// Nearest directory at or above the file that holds `marker` in the scanned tree ('' is the root).
function owner(ctx, file, marker) {
  for (let d = path.posix.dirname(file); ; d = path.posix.dirname(d)) {
    const dir = d === '.' ? '' : d;
    if (ctx.headFiles.has(dir ? `${dir}/${marker}` : marker)) return dir;
    if (!dir) return null;
  }
}

function groupBy(files, key) {
  const out = new Map();
  for (const f of files) {
    const k = key(f);
    if (k === null) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(f);
  }
  return out;
}

function python(ctx, files, report) {
  if (!installed('ruff')) return 'ruff is not installed';
  for (const f of files) {
    const out = runJson('ruff', ['check', '--isolated', '--select', RUFF_RULES, '--output-format', 'json', '--stdin-filename', f.path, '-'], { input: f.text, ok: [0, 1], timeout: 60000, empty: [] });
    for (const d of out) report(f, d.location.row, `ruff ${d.code}: ${d.message}`, d.code);
  }
  return null;
}

function javascript(ctx, files, report) {
  let pkg = {};
  try { pkg = JSON.parse(ctx.headReader.read('package.json') || '{}'); } catch { /* not ours to report here */ }
  if (!ESLINT_CONFIG.some((c) => ctx.headFiles.has(c)) && !pkg.eslintConfig) return 'the repository has no eslint config';
  // The repository's own eslint: its config loads plugins from its node_modules, which a
  // global eslint would not find.
  const bin = path.join(ctx.root, 'node_modules', '.bin', 'eslint');
  if (!fs.existsSync(bin)) return 'eslint is not installed in node_modules';
  const args = ['--format', 'json'];
  for (const r of ESLINT_RULES) args.push('--rule', r);
  const results = runJson(bin, [...args, ...files.map((f) => f.path)], { name: 'eslint', cwd: ctx.root, ok: [0, 1], timeout: 120000 });
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const r of results) {
    const f = byPath.get(path.relative(ctx.root, r.filePath).split(path.sep).join('/'));
    if (!f) continue;
    for (const m of r.messages) {
      if (m.fatal) throw new Error(`eslint could not parse ${f.path}: ${m.message}`);
      if (ESLINT_IDS.has(m.ruleId)) report(f, m.line, `eslint ${m.ruleId}: ${m.message}`, m.ruleId);
    }
  }
  return null;
}

function go(ctx, files, report) {
  if (!installed('golangci-lint')) return 'golangci-lint is not installed';
  for (const [mod, list] of groupBy(files, (f) => owner(ctx, f.path, 'go.mod'))) {
    const cwd = path.join(ctx.root, mod);
    const pkgs = [...new Set(list.map((f) => `./${path.posix.relative(mod, path.posix.dirname(f.path)) || '.'}`))];
    const out = runJson('golangci-lint', ['run', '--no-config', '--enable-only', 'gocyclo,nestif', '--output.json.path', 'stdout', '--show-stats=false', '--max-issues-per-linter', '0', '--max-same-issues', '0', ...pkgs], { cwd, ok: [0, 1], timeout: CARGO_MS });
    const byPath = new Map(list.map((f) => [f.path, f]));
    for (const d of out.Issues || []) {
      const f = byPath.get(path.posix.join(mod, d.Pos.Filename));
      // A package that does not build cannot be measured, which is not the same as clean.
      if (d.FromLinter === 'typecheck') throw new Error(`golangci-lint could not load ${path.posix.join(mod, d.Pos.Filename)}: ${d.Text}`);
      if (f) report(f, d.Pos.Line, `golangci-lint ${d.FromLinter}: ${d.Text}`, d.FromLinter);
    }
  }
  return null;
}

function rust(ctx, files, report) {
  if (!installed('cargo')) return 'cargo is not installed';
  for (const [crate, list] of groupBy(files, (f) => owner(ctx, f.path, 'Cargo.toml'))) {
    const manifest = path.join(ctx.root, crate, 'Cargo.toml');
    // Diagnostic paths are relative to the workspace root, which can sit above the crate.
    const ws = path.dirname(run('cargo', ['locate-project', '--workspace', '--message-format', 'plain', '--manifest-path', manifest], { name: 'cargo locate-project', cwd: ctx.root }).stdout.trim());
    const out = run('cargo', ['clippy', '--quiet', '--message-format=json', '--manifest-path', manifest, '--', '-W', 'clippy::cognitive_complexity'], { name: 'cargo clippy', cwd: ctx.root, timeout: CARGO_MS }).stdout;
    const byPath = new Map(list.map((f) => [f.path, f]));
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { throw new Error(`cargo clippy printed a line that is not JSON: ${line.slice(0, 200)}`); }
      if (d.reason !== 'compiler-message' || (d.message.code || {}).code !== 'clippy::cognitive_complexity') continue;
      const span = d.message.spans.find((s) => s.is_primary);
      const f = span && byPath.get(path.relative(ctx.root, path.resolve(ws, span.file_name)).split(path.sep).join('/'));
      if (f) report(f, span.line_start, `clippy cognitive_complexity: ${d.message.message}`, 'cognitive_complexity');
    }
  }
  return null;
}

const LANGS = [
  { id: 'py', name: 'Python', run: python, disk: false },
  { id: 'js', name: 'JavaScript/TypeScript', run: javascript, disk: true },
  { id: 'go', name: 'Go', run: go, disk: true },
  { id: 'rust', name: 'Rust', run: rust, disk: true },
];

module.exports = {
  id: 'complexity',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    const count = new Map();
    // One finding per line: several rules on one function (too complex and too many
    // arguments) are one thing to judge.
    const at = new Map();
    const report = (f, line, message, token) => {
      if (!f.addedLines.has(line) || line >= f.cutoff) return;
      const key = `${f.path}:${line}`;
      if (at.has(key)) { at.get(key).problems.push(message); return; }
      count.set(f.path, (count.get(f.path) || 0) + 1);
      if (count.get(f.path) > PER_FILE) return;
      const it = { check: 'complexity', severity: 'review', file: f.path, line, excerpt: (f.text.split('\n')[line - 1] || '').trim().slice(0, 160), token, problems: [message] };
      at.set(key, it);
      items.push(it);
    };
    // These linters read the files from disk, so they measure only a scan of the checked-out tree.
    const onDisk = !ctx.head || ctx.head === 'HEAD';
    for (const L of LANGS) {
      const files = [];
      for (const f of ctx.files) {
        if (f.kind !== 'code' || f.status === 'D' || lang(f.path) !== L.id || !/\.(py|[cm]?[jt]sx?|go|rs)$/.test(f.path) || !f.added.length || RUST_TESTS.test(f.path) || SNAPSHOT.test(f.path)) continue;
        const text = ctx.headReader.read(f.path);
        if (text === null || text.length > MAX_FILE || isGenerated(text)) continue;
        files.push({ path: f.path, text, addedLines: new Set(f.added.map((a) => a.line)), cutoff: testCutoff(text, L.id) });
      }
      if (!files.length) continue;
      const skipped = L.disk && !onDisk ? 'its linter reads the checked-out tree, not another revision' : L.run(ctx, files, report);
      if (skipped) ctx.skip(`complexity: ${L.name} not measured (${skipped})`);
    }
    return items.map(({ problems, ...it }) => ({ ...it, message: `${problems.join('; ')}; ${HINT}` }));
  },
};
