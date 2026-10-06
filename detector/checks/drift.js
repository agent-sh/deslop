'use strict';
// Leftover mentions of something the change retired: a deleted or moved file, a removed
// function, flag or environment variable, or a value replaced by another (version, count,
// name). Mentions in prose and settings are what no compiler or test catches.
const path = require('path');
const { tokens, tokenType, lang, SKIP_KINDS } = require('../files');

const WORD = /[A-Za-z0-9_]+/g;
const PROSE = new Set(['docs', 'prompt', 'config', 'ci', 'other']);
// A line that records history (dated entry, "removed", "formerly") may name old things.
const HISTORY = /\b(removed|deleted|retired|renamed|replaced|superseded|formerly|previously|no longer|used to|once had|deprecated|legacy|was moved)\b|\b20\d\d-[01]\d-[0-3]\d\b/i;
// Frozen copies (versioned docs, archives) are meant to keep old values.
// Dated folders and files (lane-20260912/, PLAN-20260919.md) are records of their day.
const SNAPSHOT = /(^|\/)(versioned_docs|versioned_sidebars|archive|archived|snapshots?)\/|(^|\/)(version-|v)\d+(\.\d+)+\/|(^|\/)[^/]*20\d\d[01]\d[0-3]\d[^/]*(\/|\.md$)/;

const DEFS = {
  js: [/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, /^\s*(?:export\s+)?(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/],
  py: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^\s*class\s+([A-Za-z_]\w*)/, /^([A-Z][A-Z0-9_]{3,})\s*=/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+|static\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\s+([A-Za-z_]\w*)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, /^type\s+([A-Za-z_]\w*)/],
  sh: [/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)/],
  c: [/^\s*(?:class|struct|enum)\s+([A-Za-z_]\w*)/, /^#define\s+([A-Za-z_]\w*)/],
};
const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])|os\.environ(?:\.get)?[[(]\s*['"]([A-Z][A-Z0-9_]+)['"]|os\.getenv\(\s*['"]([A-Z][A-Z0-9_]+)['"]|env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]+)"|getenv\(\s*"([A-Z][A-Z0-9_]+)"|\$\{([A-Z][A-Z0-9_]+):[-=?+]/g;
const OPTION_DEF = /add_argument\(|\.option\(|\.requiredOption\(|\blong\s*[(=]|#\[arg\b|#\[clap\b|argv\.includes\(|args\.includes\(|case\s+["']?--|^\s*["']?--[a-z][\w-]*["']?\s*[:)|]/;

function similar(a, b) {
  const wa = new Set(a.match(WORD) || []);
  const wb = new Set(b.match(WORD) || []);
  if (!wa.size || !wb.size) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / Math.max(wa.size, wb.size);
}

// Names a removed line defines: functions, types, constants, CLI flags, environment reads.
function definedNames(text, l) {
  const out = [];
  for (const re of DEFS[l] || []) {
    const m = re.exec(text);
    if (m && m[1].length >= 4) out.push(m[1]);
  }
  for (const m of text.matchAll(ENV_READ)) {
    const n = m.slice(1).find(Boolean);
    if (n && n.includes('_')) out.push(n);
  }
  if (OPTION_DEF.test(text)) for (const m of text.matchAll(/--[a-z][a-z0-9]*(?:-[a-z0-9]+)+|--[a-z][a-z0-9]{3,}/g)) out.push(m[0]);
  return out.filter((n) => tokenType(n) !== 'ident' || /[_A-Z]/.test(n.slice(1)) || n.length >= 8);
}

// old -> new token pairs from a removed line and the added line that reads most like it.
function replacementPairs(file, headText) {
  const pairs = new Map();
  for (const b of file.blocks) {
    for (const r of b.removed) {
      let best = null;
      let bestScore = 0.5;
      for (const a of b.added) {
        const s = similar(r.text, a.text);
        if (s > bestScore) { best = a; bestScore = s; }
      }
      if (!best) continue;
      const rt = tokens(r.text);
      const at = tokens(best.text);
      const gone = [...rt].filter((t) => !at.has(t));
      const fresh = [...at].filter((t) => !rt.has(t));
      for (const g of gone) {
        const ty = tokenType(g);
        const match = fresh.filter((f) => tokenType(f) === ty);
        if (match.length !== 1 || pairs.has(g)) continue;
        // "129 auto-fixable" -> "457 validation" is two different counts, not one value updated.
        if (ty === 'number' && unitAfter(r.text, g) !== unitAfter(best.text, match[0])) continue;
        // An identifier counts as renamed only when the file no longer uses the old name at all.
        if (ty === 'ident' && headText && headText.includes(g)) continue;
        pairs.set(g, { to: match[0], file: file.path, line: best.line, text: r.text });
      }
    }
  }
  return pairs;
}

function bounded(text, t) {
  const isPath = tokenType(t) === 'path';
  let i = text.indexOf(t);
  while (i !== -1) {
    const b = text[i - 1];
    const a = text[i + t.length];
    const a2 = text[i + t.length + 1] || '';
    const okB = b === undefined || (isPath ? !/[A-Za-z0-9_/.-]/.test(b) : !/[A-Za-z0-9_]/.test(b));
    let okA = a === undefined || !/[A-Za-z0-9_]/.test(a);
    if (isPath && a === '/') okA = false;
    if (t.endsWith('/') && a !== undefined && (/[A-Za-z0-9_-]/.test(a) || (a === '.' && /[A-Za-z0-9]/.test(a2)))) okA = false;
    if ((a === '.' || a === '-') && /[A-Za-z0-9]/.test(a2)) okA = false; // longer name or file extension
    if (okB && okA) return true;
    i = text.indexOf(t, i + 1);
  }
  return false;
}

// Generic keys (ref, version, tag) are shared by every entry of a manifest; they say nothing
// about which entity a version belongs to.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'than', 'into', 'over', 'are', 'was', 'were', 'has', 'have', 'not', 'now', 'still', 'only', 'about', 'each', 'per', 'version', 'versions', 'release', 'ref', 'tag', 'sha', 'commit', 'pin', 'rev', 'value', 'name', 'default']);

// Up to two words on each side of the token in its old line, lower-cased.
function neighbors(text, t) {
  const i = text.indexOf(t);
  if (i < 0) return [];
  const before = (text.slice(0, i).match(/[A-Za-z][A-Za-z_-]{2,}/g) || []).slice(-2);
  const after = (text.slice(i + t.length).match(/[A-Za-z][A-Za-z_-]{2,}/g) || []).slice(0, 2);
  return [...before, ...after].map((w) => w.toLowerCase()).filter((w) => !STOPWORDS.has(w));
}

const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|setup\.cfg)$/;

// Name of the package whose version line this is, when the line is a manifest's version.
function packageName(ctx, file, line) {
  if (!MANIFEST.test(file) || !/^\s*"?version"?\s*[:=]/.test(line)) return null;
  const text = ctx.headReader.read(file) || '';
  const m = /^\s*"?name"?\s*[:=]\s*"([^"]+)"/m.exec(text);
  return m && m[1].length >= 3 ? m[1].replace(/^@[^/]+\//, '') : null;
}

// The word right after a number in its old line: "3,518 tests" -> "tests".
function unitAfter(text, t) {
  const i = text.indexOf(t);
  if (i < 0) return null;
  const m = /^\s?([A-Za-z%][A-Za-z/%-]*)/.exec(text.slice(i + t.length));
  return m ? m[1].toLowerCase() : null;
}

module.exports = {
  id: 'drift',
  scopes: ['diff'],
  run(ctx) {
    const items = [];
    const retired = new Map(); // token -> { from, line, text, to?, why }
    const added = new Set();
    const definedNow = new Set();
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      const l = lang(f.path);
      for (const a of f.added) {
        for (const t of tokens(a.text)) added.add(t);
        if (l) for (const n of definedNames(a.text, l)) definedNow.add(n);
      }
    }
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      if (f.status !== 'D') {
        const head = ctx.headReader.read(f.path);
        for (const [k, v] of replacementPairs(f, head)) if (!retired.has(k)) retired.set(k, { from: v.file, line: v.line, text: v.text, to: v.to, why: 'replaced' });
      }
      const l = lang(f.path);
      if (!l || f.kind === 'test' || f.kind === 'docs' || f.kind === 'prompt') continue;
      for (const r of f.removed) {
        for (const n of definedNames(r.text, l)) {
          if (definedNow.has(n) || added.has(n) || retired.has(n)) continue;
          retired.set(n, { from: f.oldPath, line: r.line, text: r.text, why: 'definition' });
        }
      }
    }
    for (const f of ctx.files) {
      if ((f.status === 'D' || f.status === 'R') && f.oldPath && !ctx.headFiles.has(f.oldPath)) {
        const to = f.status === 'R' ? f.path : undefined;
        retired.set(f.oldPath, { from: f.oldPath, line: 0, text: '', to, why: 'file' });
        const base = path.posix.basename(f.oldPath);
        const unique = ![...ctx.headFiles].some((p) => path.posix.basename(p) === base);
        if (unique && base.length >= 6 && /\.[a-z]+$/.test(base)) {
          retired.set(base, { from: f.oldPath, line: 0, text: '', to: to && path.posix.basename(to), why: 'file' });
        }
      }
    }
    // A directory the change emptied retires its own path too.
    const goneDirs = new Set();
    for (const f of ctx.files) {
      if (f.status !== 'D' && f.status !== 'R') continue;
      const parts = f.oldPath.split('/');
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (!ctx.dirs.has(d) && d.includes('/')) goneDirs.add(d);
      }
    }
    for (const d of goneDirs) {
      if (!retired.has(d)) retired.set(d, { from: d, line: 0, text: '', why: 'file' });
      if (!retired.has(d + '/')) retired.set(d + '/', { from: d, line: 0, text: '', why: 'file' });
    }
    const candidates = [];
    for (const [t, v] of retired) {
      if (added.has(t) && v.why !== 'file') continue;
      const ty = tokenType(t);
      if (ty === 'number' && (t.replace(/[,.]/g, '').length < 3 || !unitAfter(v.text, t))) continue;
      candidates.push(t);
    }
    if (!candidates.length) return items;
    const byToken = new Map();
    for (const h of ctx.grep(candidates)) {
      const k = ctx.kindOf(h.file);
      if (SKIP_KINDS.has(k) || k === 'changelog' || SNAPSHOT.test(h.file) || HISTORY.test(h.text)) continue;
      for (const t of candidates) {
        if (!h.text.includes(t) || !bounded(h.text, t)) continue;
        if (!byToken.has(t)) byToken.set(t, []);
        byToken.get(t).push(h);
      }
    }
    // A path and its basename hit the same line; report the line once, for the longer token.
    const lineSeen = new Map();
    for (const [t, all] of byToken) for (const h of all) {
      const k = `${h.file}:${h.line}`;
      if (!lineSeen.has(k) || lineSeen.get(k).length < t.length) lineSeen.set(k, t);
    }
    for (const [t, all0] of byToken) {
      const all = all0.filter((h) => lineSeen.get(`${h.file}:${h.line}`) === t);
      if (!all.length) continue;
      const v = retired.get(t);
      const ty = tokenType(t);
      let hs = all;
      if (v.why === 'definition') {
        // Still used by code somewhere: defined elsewhere too, so not retired.
        if (hs.some((h) => ctx.kindOf(h.file) === 'code' || ctx.kindOf(h.file) === 'test')) continue;
        hs = hs.filter((h) => PROSE.has(ctx.kindOf(h.file)));
      } else if (v.why === 'replaced') {
        if (ty === 'number') {
          const unit = unitAfter(v.text, t);
          hs = hs.filter((h) => unitAfter(h.text, t) === unit);
        }
        if (ty === 'number' || ty === 'version') {
          // Test data and unrelated lines reuse version numbers; keep lines that share a word
          // with the line that changed. A manifest's own version line names nothing, so the
          // package name stands in ("tool@0.4.1", "tool 0.4.1").
          const near = neighbors(v.text, t);
          const pkg = ty === 'version' && packageName(ctx, v.from, v.text);
          if (pkg) near.push(pkg.toLowerCase());
          // Other entries of the file being edited are other entities; the author saw them.
          hs = hs.filter((h) => ctx.kindOf(h.file) !== 'test' && h.file !== v.from && (ty === 'number' || near.some((w) => h.text.toLowerCase().includes(w))));
        }
        if (ty === 'ident') {
          hs = hs.filter((h) => PROSE.has(ctx.kindOf(h.file)));
          if (new Set(all.map((h) => h.file)).size > 3) continue; // a common word, not a renamed name
        }
      }
      if (!hs.length) continue;
      const files = new Set(hs.map((h) => h.file));
      if (files.size > 25) continue; // that common, it is vocabulary rather than one stale copy
      const where = `${v.from}${v.line ? ':' + v.line : ''}`;
      const message = v.why === 'file'
        ? (v.to ? `\`${t}\` was moved to \`${v.to}\` by this change` : `\`${t}\` was deleted by this change`)
        : v.why === 'definition'
          ? `\`${t}\` was removed from ${where} and nothing in the code defines or reads it now`
          : `\`${t}\` was changed to \`${v.to}\` in ${where}`;
      const shown = hs.slice(0, 3);
      for (const h of shown) {
        items.push({
          check: 'stale-mention',
          severity: v.why === 'replaced' && (ty === 'ident' || ty === 'name') ? 'review' : 'high',
          file: h.file,
          line: h.line,
          excerpt: h.text.trim().slice(0, 160),
          message: message + ', but this line still says it',
          token: t,
          fix: v.to ? { fixType: 'replace-token', from: t, to: v.to } : undefined,
          more: hs.length - shown.length,
        });
      }
    }
    return items;
  },
};
