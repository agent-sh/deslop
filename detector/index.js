'use strict';
// Runs the checks over a context and ranks what they report.
const { buildContext } = require('./context');

const CHECKS = ['drift', 'refs', 'anchors', 'unwired', 'text', 'tests', 'rewrite', 'secrets', 'tools'].map((id) => require(`./checks/${id}`));

// Order inside a severity: what most often turned out real in the evaluation set first.
const PRIORITY = ['secret', 'merge-residue', 'broken-file', 'local-path', 'stale-mention', 'missing-path', 'broken-anchor', 'scope-claim', 'displaced-doc-comment', 'test-cannot-fail', 'review-provenance', 'duplicate-line', 'no-caller', 'count-mismatch', 'unread-setting', 'test-swallows-failure', 'lint', 'dropped-rule', 'em-dash'];

function globToRe(g) {
  const esc = g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}(/|$)`);
}

function detect(root, opts) {
  const ctx = buildContext(root, opts);
  const ignore = (opts.ignore || []).map(globToRe);
  if (ignore.length) ctx.files = ctx.files.filter((f) => !ignore.some((re) => re.test(f.path)));
  const disabled = new Set(opts.disable || []);
  let items = [];
  const errors = [];
  for (const c of CHECKS) {
    if (!c.scopes.includes(ctx.scope) || disabled.has(c.id)) continue;
    try {
      for (const it of c.run(ctx)) items.push(it);
    } catch (e) {
      errors.push(`${c.id}: ${e.message}`);
    }
  }
  items = items.filter((it) => !disabled.has(it.check) && !ignore.some((re) => re.test(it.file)));
  // A deleted path cited in a doc shows up as both a stale mention and a missing path; keep one.
  const stale = new Set(items.filter((it) => it.check === 'stale-mention').map((it) => `${it.file}|${it.line}|${it.token}`));
  items = items.filter((it) => !(it.check === 'missing-path' && stale.has(`${it.file}|${it.line}|${it.token}`)));
  const seen = new Set();
  items = items.filter((it) => {
    const k = `${it.check}|${it.file}|${it.line}|${it.token || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const SEV = { high: 0, review: 1000, verify: 2000 };
  const rank = (it) => (SEV[it.severity] ?? 3000) + (PRIORITY.indexOf(it.check) + 1 || 999);
  items.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line);
  const total = items.length;
  const max = opts.max || 40;
  return {
    scope: ctx.scope,
    base: ctx.baseRef ? `${ctx.baseRef} (${ctx.base.slice(0, 10)})` : undefined,
    head: ctx.head || 'worktree',
    filesChanged: ctx.files.length,
    total,
    shown: Math.min(total, max),
    items: items.slice(0, max),
    errors,
  };
}

function formatText(r) {
  const out = [];
  const where = r.scope === 'diff' ? `${r.filesChanged} changed files, ${r.base}..${r.head}` : `${r.filesChanged} files`;
  out.push(`deslop: ${r.total} finding${r.total === 1 ? '' : 's'} in ${where}${r.total > r.shown ? ` (showing ${r.shown}; --max to see more)` : ''}`);
  let sev = null;
  for (const it of r.items) {
    if (it.severity !== sev) {
      sev = it.severity;
      out.push('', { high: 'HIGH: almost always a real defect', review: 'REVIEW: often real, read the line', verify: 'VERIFY: untouched lines that describe what changed; confirm each still holds' }[sev]);
    }
    out.push(`- [${it.check}] ${it.file}${it.line ? ':' + it.line : ''}: ${it.message}${it.more ? ` (+${it.more} more mentions)` : ''}`);
    if (it.excerpt) out.push(`    ${it.excerpt}`);
  }
  for (const e of r.errors) out.push(`[WARN] check failed: ${e}`);
  return out.join('\n');
}

module.exports = { detect, formatText, CHECKS };
