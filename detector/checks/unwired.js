'use strict';
// Things the change adds that nothing uses: functions with no caller, scripts nothing runs,
// settings nothing reads.
const path = require('path');
const { lang, SKIP_KINDS, TEXT_KINDS } = require('../files');

const DEF = {
  js: [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/],
  py: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
  sh: [/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/],
};
const ENTRY = /^(main|run|setup|teardown|init|new|default|drop|fmt|from|into|clone|eq|hash|handler|render|constructor|toString|toJSON|__\w+__)$/;
const RUNNER_DISCOVERED = /(^|\/)(test_[^/]*\.py|[^/]*_test\.(py|go)|[^/]*\.(test|spec)\.[cm]?[jt]sx?|conftest\.py)$|(^|\/)__tests__\/|(^|\/)tests\/[^/]+\.rs$|(^|\/)(index|main|mod|lib|__init__|__main__|setup)\.[a-z]+$|\.d\.ts$|(^|\/)build\.rs$/;
const SCRIPT_EXT = new Set(['.sh', '.bash', '.py', '.mjs', '.cjs', '.js', '.ts', '.rb', '.ps1']);
// .env, prod.env, .env.local, settings.template
const ENV_FILE = /(^|\/)[^/]*\.env(\.[^/]+)?$|\.template$/;
const ENV_ASSIGN = /^\s*(?:export\s+)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)=/;

function exportedOrPublic(text, l) {
  if (l === 'rust') return /^\s*pub\b/.test(text);
  if (l === 'js') return /^\s*export\b/.test(text);
  if (l === 'go') return /^func\s+(?:\([^)]*\)\s*)?[A-Z]/.test(text);
  return false;
}

module.exports = {
  id: 'unwired',
  scopes: ['diff'],
  run(ctx) {
    const items = [];
    const defs = [];
    const newFiles = [];
    const envs = [];
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      const l = lang(f.path);
      if (f.status === 'A' && SCRIPT_EXT.has(path.extname(f.path)) && !RUNNER_DISCOVERED.test(f.path)) newFiles.push(f);
      for (const a of f.added) {
        if (l && DEF[l] && f.kind !== 'test') {
          for (const re of DEF[l]) {
            const m = re.exec(a.text);
            if (!m) continue;
            const name = m[1];
            if (name.length < 4 || ENTRY.test(name) || /^test/i.test(name)) break;
            // Decorated Python functions and attribute-marked Rust items are wired by the framework.
            const lines = ctx.lines(f.path) || [];
            const prev = (lines[a.line - 2] || '').trim();
            if (prev.startsWith('@') || /^#\[(test|tokio::test|bench|no_mangle|export_name|wasm_bindgen|napi|pyfunction|proc_macro)/.test(prev)) break;
            defs.push({ name, f, a, public: exportedOrPublic(a.text, l) });
            break;
          }
        }
        if ((f.kind === 'config' || ENV_FILE.test(f.path)) && !/\.(json|ya?ml|toml)$/.test(f.path)) {
          const m = ENV_ASSIGN.exec(a.text);
          if (m) envs.push({ name: m[1], f, a });
        }
      }
    }
    const stem = (f) => path.posix.basename(f.path).replace(/\.[^.]+$/, '');
    const names = [...new Set([...defs.map((d) => d.name), ...envs.map((e) => e.name), ...newFiles.map((f) => path.posix.basename(f.path)), ...newFiles.map(stem)])];
    if (!names.length) return items;
    const hits = ctx.grep(names);
    const uses = (name, skip) => hits.filter((h) => {
      if (skip(h)) return false;
      const i = h.text.indexOf(name);
      if (i < 0) return false;
      const b = h.text[i - 1];
      const e = h.text[i + name.length];
      return !(b && /[\w$]/.test(b)) && !(e && /[\w$]/.test(e));
    });
    for (const d of defs) {
      const u = uses(d.name, (h) => h.file === d.f.path && h.line === d.a.line);
      if (u.length) continue;
      items.push({
        check: 'no-caller',
        severity: d.public ? 'review' : 'high',
        file: d.f.path,
        line: d.a.line,
        excerpt: d.a.text.trim().slice(0, 160),
        message: d.public
          ? `new public \`${d.name}\` has no caller anywhere in the repo`
          : `new \`${d.name}\` is never called`,
      });
    }
    for (const f of newFiles) {
      const base = path.posix.basename(f.path);
      const dir = path.posix.dirname(f.path);
      const u = uses(base, (h) => h.file === f.path);
      if (u.length) continue;
      // Modules are loaded by name without the extension: require('./checks/x'), ['x', 'y'], from .x import.
      const s = stem(f);
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const byName = new RegExp(`(['"\`/])${esc}(\\.[a-z]+)?['"\`]|\\bimport\\s+${esc}\\b|\\bfrom\\s+\\S*\\b${esc}\\b|\\bmod\\s+${esc}\\s*;`);
      if (hits.some((h) => h.file !== f.path && byName.test(h.text))) continue;
      // A runner that globs the directory (tests/*.sh, scripts/**) also counts as a caller.
      const globbed = ctx.grep([dir + '/*', dir + '/**', dir + '/']).some((h) => h.file !== f.path && !TEXT_KINDS.has(ctx.kindOf(h.file)));
      if (globbed) continue;
      items.push({
        check: 'no-caller',
        severity: f.kind === 'test' ? 'high' : 'review',
        file: f.path,
        line: 1,
        excerpt: '(new file)',
        message: f.kind === 'test'
          ? `new test script \`${base}\` is not run by CI, a package script or any other file`
          : `new script \`${base}\` is not referenced by any other file`,
      });
    }
    for (const e of envs) {
      const readers = uses(e.name, (h) => {
        const k = ctx.kindOf(h.file);
        return TEXT_KINDS.has(k) || h.file === e.f.path || ENV_FILE.test(h.file);
      });
      if (readers.length) continue;
      items.push({
        check: 'unread-setting',
        severity: 'review',
        file: e.f.path,
        line: e.a.line,
        excerpt: e.a.text.trim().slice(0, 160),
        message: `\`${e.name}\` is set here but no code, script or workflow in the repo reads it`,
      });
    }
    return items;
  },
};
