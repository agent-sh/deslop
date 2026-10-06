'use strict';
// Linters that already know a language, run on the changed files only, reporting only the
// lines this change added. Each runs only when it is installed; content goes in on stdin.
const path = require('path');
const { lang, SKIP_KINDS } = require('../files');
const { runJson, installed } = require('../proc');

// Each linter exits 1 when it found something.
const lint = (bin, args, input, empty) => runJson(bin, args, { input, empty, ok: [0, 1], timeout: 60000 });

const RUFF_RULES = 'F401,F811,F821,F841,F632,B006,B011,B017,B018,E711,E712,PLE';

// .json files that the tools reading them parse as JSONC (comments, trailing commas). Any
// other .json is read with JSON.parse somewhere, so it stays strict.
const JSONC = /(^|\/)(devcontainer|\.devcontainer|tsconfig[^/]*|jsconfig[^/]*|\.eslintrc|turbo|biome|deno|\.swcrc|api-extractor|typedoc|language-configuration|nx|project|angular|babel\.config|cspell|\.cspell)\.json$|(^|\/)\.vscode\/[^/]+\.json$|(^|\/)\.devcontainer\/[^/]+\.json$/;

function parsesAsJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[++i] || ''; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return false; i++; continue; }
    out += c;
  }
  try { JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')); return true; } catch { return false; }
}

module.exports = {
  id: 'tools',
  scopes: ['diff'],
  run(ctx) {
    const items = [];
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind) || !f.added.length || f.status === 'D') continue;
      const content = ctx.headReader.read(f.path);
      if (content === null) continue;
      const added = new Set(f.added.map((a) => a.line));
      const l = lang(f.path);
      const isShell = l === 'sh' || /^#!.*\b(ba|z)?sh\b/.test(content.split('\n', 1)[0]);
      const push = (line, msg, tool) => {
        if (!added.has(line)) return;
        const text = (content.split('\n')[line - 1] || '').trim();
        items.push({ check: 'lint', severity: 'review', file: f.path, line, excerpt: text.slice(0, 160), message: `${tool}: ${msg}` });
      };
      if (isShell && installed('shellcheck')) {
        // SC2034 (unused variable) fires on read placeholders and exported config; too noisy.
        for (const c of lint('shellcheck', ['-f', 'json1', '-S', 'warning', '-'], content, { comments: [] }).comments) if (c.code !== 2034) push(c.line, `SC${c.code} ${c.message}`, 'shellcheck');
      }
      if (path.extname(f.path) === '.py' && installed('ruff')) {
        for (const c of lint('ruff', ['check', '--isolated', '--select', RUFF_RULES, '--output-format', 'json', '--stdin-filename', f.path, '-'], content, [])) push(c.location.row, `${c.code} ${c.message}`, 'ruff');
      }
      if (f.kind === 'ci' && /\.ya?ml$/.test(f.path) && installed('actionlint')) {
        for (const c of lint('actionlint', ['-format', '{{json .}}', '-stdin-filename', f.path, '-'], content, [])) push(c.line, c.message, 'actionlint');
      }
      // Many .json files are JSONC (devcontainer, eslint, turbo, tsconfig): comments and
      // trailing commas are fine there. Test fixtures may be invalid on purpose.
      if (path.extname(f.path) === '.json' && f.kind !== 'test') {
        const json = content.replace(/^\uFEFF/, ''); // editors may write a byte order mark
        try { JSON.parse(json); } catch (e) {
          if (!(JSONC.test(f.path) && parsesAsJsonc(json))) {
            items.push({ check: 'broken-file', severity: 'high', file: f.path, line: 1, excerpt: '', message: `does not parse as JSON: ${e.message.slice(0, 120)}` });
          }
        }
      }
    }
    return items;
  },
};
