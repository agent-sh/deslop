'use strict';
// Linters that already know a language, run on the changed files only, reporting only the
// lines this change added. Each runs only when it is installed; content goes in on stdin.
const { spawnSync } = require('child_process');
const path = require('path');
const { lang, SKIP_KINDS } = require('../files');

const have = new Map();
function installed(bin) {
  if (!have.has(bin)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    have.set(bin, !r.error && r.status === 0);
  }
  return have.get(bin);
}

function run(bin, args, input) {
  const r = spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  return r.error ? null : r.stdout;
}

const RUFF_RULES = 'F401,F811,F821,F841,F632,F811,B006,B011,B017,B018,E711,E712,PLE';

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
        const out = run('shellcheck', ['-f', 'json1', '-S', 'warning', '-'], content);
        // SC2034 (unused variable) fires on read placeholders and exported config; too noisy.
        try { for (const c of JSON.parse(out || '{}').comments || []) if (c.code !== 2034) push(c.line, `SC${c.code} ${c.message}`, 'shellcheck'); } catch { /* unparseable output: skip */ }
      }
      if (path.extname(f.path) === '.py' && installed('ruff')) {
        const out = run('ruff', ['check', '--isolated', '--select', RUFF_RULES, '--output-format', 'json', '--stdin-filename', f.path, '-'], content);
        try { for (const c of JSON.parse(out || '[]')) push(c.location.row, `${c.code} ${c.message}`, 'ruff'); } catch { /* skip */ }
      }
      if (f.kind === 'ci' && /\.ya?ml$/.test(f.path) && installed('actionlint')) {
        const out = run('actionlint', ['-format', '{{json .}}', '-stdin-filename', f.path, '-'], content);
        try { for (const c of JSON.parse(out || '[]')) push(c.line, c.message, 'actionlint'); } catch { /* skip */ }
      }
      if (path.extname(f.path) === '.json' && !/tsconfig|jsconfig|\.vscode\//.test(f.path)) {
        try { JSON.parse(content); } catch (e) {
          items.push({ check: 'broken-file', severity: 'high', file: f.path, line: 1, excerpt: '', message: `does not parse as JSON: ${e.message.slice(0, 120)}` });
        }
      }
    }
    return items;
  },
};
