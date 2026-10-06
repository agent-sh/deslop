'use strict';
// Added code that already exists elsewhere in the repo, or twice in the change. Code is
// compared as tokens: identifiers kept, literals and whitespace normalized, comments and
// import lines dropped. Files are fingerprinted by winnowing (hashes of K-token windows, the
// minimum of each WINDOW of them), which finds every shared run of at least K + WINDOW - 1
// tokens while comparing a fraction of the hashes.
const { lang, SNAPSHOT } = require('../files');
const { lex, isGenerated, testCutoff, KEYWORDS } = require('../code');

const K = 20; // tokens per hashed window
const WINDOW = 40; // winnowing window; K + WINDOW - 1 = 59 is under MIN_TOKENS, so no match is missed
const MIN_TOKENS = 60;
const MIN_LINES = 6; // distinct non-trivial lines, so a table of same-shaped rows is not a copy
const MAX_FILE = 1024 * 1024;
// Lexing runs at roughly 20-40 MB/s; this keeps the scan to a couple of seconds on a large repo.
const SCAN_BUDGET = 48 * 1024 * 1024;
const LEXED = new Set(['js', 'py', 'rust', 'go', 'sh', 'c']);
const IMPORT = /^\s*(import\b|from\s+\S+\s+import\b|use\s+[\w:{]|#\s*include\b|package\s+\w|extern\s+crate\b|mod\s+\w+\s*;|(const|let|var)\s+[\w{},\s:]+=\s*require\(|require\(|export\s+(\*|\{[^}]*\})\s+from\b|source\s|\.\s+\S+$)/;
const PRIME = 0x01000193;
// Rust unit tests often live in src/tests.rs, which the file kinds do not call a test.
const RUST_TESTS = /(^|\/)tests?\.rs$/;

function prepare(path, text, l, intern) {
  const lines = text.split('\n');
  const cutoff = testCutoff(text, l);
  const { toks } = lex(text, l);
  const kept = toks.filter((t) => t.line < cutoff && !IMPORT.test(lines[t.line - 1] || ''));
  const ids = new Int32Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    let id = intern.get(kept[i].v);
    if (id === undefined) { id = intern.size + 1; intern.set(kept[i].v, id); }
    ids[i] = Math.imul(id, 0x9e3779b1) + 1;
  }
  return { path, l, toks: kept, ids };
}

// Hash of every K-token window, by position.
function kgrams(ids) {
  const n = ids.length - K + 1;
  if (n <= 0) return new Int32Array(0);
  const out = new Int32Array(n);
  let pow = 1;
  for (let i = 0; i < K; i++) pow = Math.imul(pow, PRIME);
  let h = 0;
  for (let t = 0; t < ids.length; t++) {
    h = (Math.imul(h, PRIME) + ids[t]) | 0;
    if (t >= K) h = (h - Math.imul(ids[t - K], pow)) | 0;
    if (t >= K - 1) out[t - K + 1] = h;
  }
  return out;
}

// Winnowing: the rightmost minimum hash of each window of WINDOW consecutive hashes.
function winnow(hashes) {
  const out = [];
  if (!hashes.length) return out;
  if (hashes.length < WINDOW) {
    let m = 0;
    for (let i = 1; i < hashes.length; i++) if (hashes[i] <= hashes[m]) m = i;
    return [m];
  }
  const dq = new Int32Array(hashes.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < hashes.length; i++) {
    while (tail > head && hashes[dq[tail - 1]] >= hashes[i]) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - WINDOW) head++;
    if (i >= WINDOW - 1 && out[out.length - 1] !== dq[head]) out.push(dq[head]);
  }
  return out;
}

// Distinct lines with real content: at least three tokens and a name that is not a keyword.
function substantialLines(toks, from, to) {
  const byLine = new Map();
  for (let i = from; i < to; i++) {
    const t = toks[i];
    if (!byLine.has(t.line)) byLine.set(t.line, []);
    byLine.get(t.line).push(t.v);
  }
  const distinct = new Set();
  for (const vs of byLine.values()) {
    if (vs.length >= 3 && vs.some((v) => /^[A-Za-z_$]/.test(v) && !KEYWORDS.has(v))) distinct.add(vs.join(' '));
  }
  return distinct.size;
}

// Added code files, lexed, with their runs of at least MIN_TOKENS tokens on added lines.
function addedRuns(ctx, intern) {
  const changed = [];
  for (const f of ctx.files) {
    const l = lang(f.path);
    // Snapshots and dated record folders keep copies of code on purpose.
    if (f.kind !== 'code' || f.status === 'D' || !LEXED.has(l) || f.added.length < MIN_LINES || RUST_TESTS.test(f.path) || SNAPSHOT.test(f.path)) continue;
    const text = ctx.headReader.read(f.path);
    if (text === null || text.length > MAX_FILE || isGenerated(text)) continue;
    const p = prepare(f.path, text, l, intern);
    p.added = new Set(f.added.map((a) => a.line));
    p.runs = [];
    let start = -1;
    for (let i = 0; i <= p.toks.length; i++) {
      const on = i < p.toks.length && p.added.has(p.toks[i].line);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start >= MIN_TOKENS) p.runs.push([start, i]);
        start = -1;
      }
    }
    if (p.runs.length) changed.push(p);
  }
  return changed;
}

// Narrow the files to read: any copy of 60 tokens holds a full aligned 20-token chunk of a run,
// so it holds that chunk's longest name. Closest directories first, within the scan budget.
function otherFiles(ctx, changed, intern) {
  let candidates;
  if (ctx.scope === 'diff') {
    const probes = new Set();
    for (const a of changed) {
      for (const [s, e] of a.runs) {
        for (let c = s; c + 20 <= e; c += 20) {
          let best = '';
          for (let i = c; i < c + 20; i++) {
            const v = a.toks[i].v;
            if (v.length > best.length && /^[A-Za-z_$]/.test(v) && !KEYWORDS.has(v)) best = v;
          }
          if (best.length >= 3) probes.add(best);
        }
      }
    }
    candidates = ctx.filesWith([...probes]);
  } else {
    candidates = ctx.files.map((f) => f.path);
  }
  const families = new Set(changed.map((a) => a.l));
  const changedPaths = new Set(changed.map((a) => a.path));
  const dirsOf = (p) => p.split('/').slice(0, -1);
  const near = (p) => Math.max(...changed.map((a) => {
    const [d, e] = [dirsOf(p), dirsOf(a.path)];
    let k = 0;
    while (k < d.length && k < e.length && d[k] === e[k]) k++;
    return k;
  }));
  const paths = [...new Set(candidates)]
    .filter((p) => !changedPaths.has(p) && families.has(lang(p)) && ctx.kindOf(p) === 'code' && !RUST_TESTS.test(p) && !SNAPSHOT.test(p))
    .map((p) => ({ p, near: near(p) }))
    .sort((x, y) => y.near - x.near || x.p.localeCompare(y.p))
    .map((x) => x.p);
  const texts = ctx.headReader.readMany ? ctx.headReader.readMany(paths) : paths.map((p) => ctx.headReader.read(p));
  const out = [];
  let budget = SCAN_BUDGET;
  paths.forEach((p, k) => {
    const text = texts[k];
    if (text === null || text.length > MAX_FILE || budget <= 0 || isGenerated(text)) return;
    budget -= text.length;
    out.push(prepare(p, text, lang(p), intern));
  });
  return out;
}

// Seed on shared fingerprints, then extend each seed to the longest equal run of tokens.
function matches(changed, scan) {
  // Both sides are winnowed: a shared run of K + WINDOW - 1 tokens holds a whole window whose
  // minimum both sides select, so no qualifying copy is missed.
  const want = new Map(); // fingerprint inside an added run -> [{a, i}]
  for (const a of changed) {
    const h = kgrams(a.ids);
    for (const i of winnow(h)) {
      if (!a.runs.some(([s, e]) => i >= s && i + K <= e)) continue;
      let list = want.get(h[i]);
      if (!list) { list = []; want.set(h[i], list); }
      if (list.length < 16) list.push({ a, i });
    }
  }
  const found = [];
  const covered = new Map(); // "a\0b" -> token ranges of a already matched against b
  for (const b of scan) {
    const hashes = kgrams(b.ids);
    for (const j of winnow(hashes)) {
      for (const { a, i } of want.get(hashes[j]) || []) {
        if (a.l !== b.l) continue;
        const key = `${a.path}\0${b.path}`;
        const cov = covered.get(key) || [];
        if (cov.some(([s, e]) => i >= s && i < e)) continue;
        const m = extend(a, i, b, j);
        if (!m) continue;
        cov.push([m.a0, m.a1]);
        covered.set(key, cov);
        found.push(m);
      }
    }
  }
  return found;
}

function extend(a, i, b, j) {
  for (let t = 0; t < K; t++) if (a.ids[i + t] !== b.ids[j + t]) return null; // hash collision
  const run = a.runs.find(([s, e]) => i >= s && i < e);
  let [a0, b0, a1, b1] = [i, j, i + K, j + K];
  while (a0 > run[0] && b0 > 0 && a.ids[a0 - 1] === b.ids[b0 - 1]) { a0--; b0--; }
  while (a1 < run[1] && b1 < b.ids.length && a.ids[a1] === b.ids[b1]) { a1++; b1++; }
  if (a === b && a0 < b1 && b0 < a1) return null; // the same text, or a pattern overlapping itself
  if (a1 - a0 < MIN_TOKENS || substantialLines(a.toks, a0, a1) < MIN_LINES) return null;
  // Both copies new in this change: report the later one only.
  const bAdded = b.added && b.toks.slice(b0, b1).every((t) => b.added.has(t.line));
  if (bAdded && (b.path > a.path || (b.path === a.path && b0 > a0))) return null;
  return { a, b, a0, a1, b0, b1 };
}

// A match can start or end mid-line (the copy renamed the function); report whole lines.
function wholeLines(toks, from, to) {
  let s = from;
  while (s < to && s > 0 && toks[s - 1].line === toks[s].line) s++;
  let e = to - 1;
  while (e > s && e + 1 < toks.length && toks[e + 1].line === toks[e].line) e--;
  return s < e ? [toks[s].line, toks[e].line] : [toks[from].line, toks[to - 1].line];
}

// One finding per added block: the longest copy it repeats, then the other places.
function report(ctx, found) {
  const blocks = [];
  // Largest first, so the smaller matches inside a block join it instead of starting their own.
  for (const m of [...found].sort((x, y) => (y.a1 - y.a0) - (x.a1 - x.a0))) {
    const [aStart, aEnd] = wholeLines(m.a.toks, m.a0, m.a1);
    const [bStart, bEnd] = wholeLines(m.b.toks, m.b0, m.b1);
    const where = m.b === m.a ? `lines ${bStart}-${bEnd} of this file` : `${m.b.path}:${bStart}-${bEnd}`;
    const entry = { where, place: m.b === m.a ? 'this file' : m.b.path, size: m.a1 - m.a0, token: `${m.b.path}:${bStart}`, start: aStart, end: aEnd };
    const block = blocks.find((x) => x.file === m.a.path && aStart <= x.end && x.start <= aEnd);
    if (block) {
      block.copies.push(entry);
      block.start = Math.min(block.start, aStart);
      block.end = Math.max(block.end, aEnd);
    } else blocks.push({ file: m.a.path, start: aStart, end: aEnd, copies: [entry] });
  }
  const items = [];
  const perFile = new Map();
  for (const blk of blocks.sort((x, y) => x.file.localeCompare(y.file) || x.start - y.start)) {
    const n = (perFile.get(blk.file) || 0) + 1;
    perFile.set(blk.file, n);
    if (n > 3) continue;
    blk.copies.sort((x, y) => y.size - x.size);
    const [main, ...rest] = blk.copies;
    const others = [...new Set(rest.map((c) => c.place))].filter((w) => w !== main.place);
    const also = others.length ? ` (also in ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''})` : '';
    items.push({
      check: 'duplicate-code',
      severity: 'review',
      file: blk.file,
      line: main.start,
      excerpt: (ctx.lines(blk.file) || [])[main.start - 1]?.trim().slice(0, 160) || '',
      message: `lines ${main.start}-${main.end} repeat ${main.where}${also}; reuse that code or extract one shared helper`,
      token: main.token,
    });
  }
  return items;
}

module.exports = {
  id: 'duplicates',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const intern = new Map();
    const changed = addedRuns(ctx, intern);
    if (!changed.length) return [];
    const scan = [...changed, ...otherFiles(ctx, changed, intern)];
    return report(ctx, matches(changed, scan));
  },
};
