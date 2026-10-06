'use strict';
// Git access for the detector. Everything reads from a revision (or the work tree with
// rev === null), so the detector never needs a checkout of the commit it inspects.
const { spawnSync } = require('child_process');

const MAX = 256 * 1024 * 1024;

function git(root, args, { input, allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: MAX, input });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  }
  return r.status === 0 ? r.stdout : '';
}

function isRepo(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
  return r.status === 0;
}

function defaultBase(root) {
  const head = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true }).trim();
  const candidates = [head, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const c of candidates) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`], { allowFail: true }).trim()) return c;
  }
  return null;
}

function mergeBase(root, a, b) {
  return git(root, ['merge-base', a, b || 'HEAD'], { allowFail: true }).trim() || null;
}

// Tracked paths at rev (or the index when rev is null).
function listFiles(root, rev) {
  const out = rev ? git(root, ['ls-tree', '-r', '--name-only', '-z', rev]) : git(root, ['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

class BlobReader {
  constructor(root, rev) {
    this.root = root;
    this.rev = rev;
    this.cache = new Map();
  }
  read(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    let text = null;
    if (this.rev) {
      const r = spawnSync('git', ['-C', this.root, 'cat-file', 'blob', `${this.rev}:${path}`], { maxBuffer: MAX });
      if (r.status === 0) text = r.stdout;
    } else {
      try { text = require('fs').readFileSync(require('path').join(this.root, path)); } catch { text = null; }
    }
    if (text !== null) {
      // Binary content is treated as unreadable.
      text = text.subarray(0, 8000).includes(0) ? null : text.toString('utf8');
    }
    this.cache.set(path, text);
    return text;
  }
  // Many blobs in one git process; one spawn per file is too slow for a few thousand files.
  readMany(paths) {
    const want = paths.filter((p) => !this.cache.has(p));
    if (this.rev && want.length > 1) {
      const r = spawnSync('git', ['-C', this.root, 'cat-file', '--batch'], { input: want.map((p) => `${this.rev}:${p}`).join('\n') + '\n', maxBuffer: 4 * MAX });
      if (r.status === 0) {
        const out = r.stdout;
        let pos = 0;
        for (const p of want) {
          const nl = out.indexOf(10, pos);
          if (nl < 0) break;
          const header = out.subarray(pos, nl).toString('utf8');
          pos = nl + 1;
          const m = / blob (\d+)$/.exec(header);
          if (!m) { this.cache.set(p, null); continue; }
          const size = Number(m[1]);
          const buf = out.subarray(pos, pos + size);
          pos += size + 1;
          this.cache.set(p, buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8'));
        }
      }
    }
    return paths.map((p) => this.read(p));
  }
}

const EXCLUDE_GLOBS = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', '*.min.js', '*.map', 'node_modules/**', 'vendor/**', 'third_party/**', 'dist/**']
  .map((g) => `**/${g}`);
const EXCLUDE = EXCLUDE_GLOBS.map((g) => `:(exclude,glob)${g}`);

// git grep tries every pattern on every line; on a large repo that can take minutes.
const SLOW_SEARCH_MS = 180000;
let rgOk;
function haveRg() {
  if (process.env.DESLOP_NO_RG) return false; // force the git grep path (tests, debugging)
  if (rgOk === undefined) {
    const r = spawnSync('rg', ['--version'], { encoding: 'utf8' });
    rgOk = !r.error && r.status === 0;
  }
  return rgOk;
}

// ripgrep matches all tokens in one pass (Aho-Corasick); git grep tries each pattern on each
// line, which takes minutes on a large repo with a few hundred tokens. rg reads the work tree,
// so it is used only when the scan targets the checked-out tree.
// No per-file match cap: it counts lines across all tokens, so common tokens would hide the
// one line that mentions a rare one.
function rgMany(root, tokens, tracked) {
  const args = ['-n', '--null', '--no-heading', '--with-filename', '--no-config', '-F', '--hidden', '--path-separator', '/', '-M', '4000', '-f', '-', '-g', '!.git'];
  for (const g of EXCLUDE_GLOBS) args.push('-g', `!${g}`);
  args.push('.');
  const r = spawnSync('rg', args, { cwd: root, input: tokens.join('\n') + '\n', encoding: 'utf8', maxBuffer: MAX });
  if (r.error && r.error.code === 'ENOBUFS') {
    // Too much output for one pass: search each half on its own. A single token that fills
    // the buffer is everywhere, which every check treats as vocabulary, so it gets no hits.
    if (tokens.length === 1) return [];
    const half = Math.ceil(tokens.length / 2);
    const a = rgMany(root, tokens.slice(0, half), tracked);
    const b = a && rgMany(root, tokens.slice(half), tracked);
    return a && b ? a.concat(b) : null;
  }
  // Exit 2 means some file could not be read; the matches printed are still valid.
  if (r.error || r.status > 2) return null;
  const hits = [];
  for (const rec of r.stdout.split('\n')) {
    const z = rec.indexOf('\0');
    if (z < 0) continue;
    const file = rec.slice(0, z).replace(/^\.\//, '');
    if (tracked && !tracked.has(file)) continue;
    const rest = rec.slice(z + 1);
    const c = rest.indexOf(':');
    const text = rest.slice(c + 1);
    if (text.startsWith('[Omitted long line')) continue;
    hits.push({ file, line: Number(rest.slice(0, c)), text });
  }
  return hits;
}

// Fixed-string search for many tokens at once. Returns [{file, line, text}] for lines holding any token.
function grepMany(root, rev, tokens, { pathspecs = [], tracked, untracked = false } = {}) {
  if (!tokens.length) return [];
  if (!rev && !pathspecs.length && haveRg()) {
    const hits = rgMany(root, tokens, tracked);
    if (hits) return hits;
  }
  const args = ['grep', '-n', '-I', '--no-color', '-F', '-z', '--full-name', '-f', '-'];
  if (rev) args.push(rev);
  else if (untracked) args.push('--untracked');
  args.push('--', ...(pathspecs.length ? pathspecs : ['.']), ...EXCLUDE);
  const r = spawnSync('git', ['-C', root, ...args], { input: tokens.join('\n') + '\n', encoding: 'utf8', maxBuffer: MAX, timeout: SLOW_SEARCH_MS });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    throw new Error(`git grep took over ${SLOW_SEARCH_MS / 1000}s on this repository; install ripgrep (rg) and run again`);
  }
  const out = r.status === 0 ? r.stdout : '';
  const hits = [];
  // -z output: "<rev>:<file>\0<line>\0<text>\n" (rev prefix only when rev given)
  for (const rec of out.split('\n')) {
    if (!rec) continue;
    const parts = rec.split('\0');
    if (parts.length < 3) continue;
    let file = parts[0];
    if (rev && file.startsWith(rev + ':')) file = file.slice(rev.length + 1);
    hits.push({ file, line: Number(parts[1]), text: parts.slice(2).join('\0') });
  }
  return hits;
}

// Files holding any of the fixed strings, for narrowing a scan before reading files.
function filesWithAny(root, rev, tokens, { tracked, untracked = false } = {}) {
  if (!tokens.length) return [];
  if (!rev && haveRg()) {
    const args = ['-l', '--null', '--no-config', '-F', '--hidden', '--path-separator', '/', '-f', '-', '-g', '!.git'];
    for (const g of EXCLUDE_GLOBS) args.push('-g', `!${g}`);
    args.push('.');
    const r = spawnSync('rg', args, { cwd: root, input: tokens.join('\n') + '\n', encoding: 'utf8', maxBuffer: MAX });
    if (!r.error && r.status <= 2) {
      return r.stdout.split('\0').filter(Boolean).map((f) => f.replace(/^\.\//, '')).filter((f) => !tracked || tracked.has(f));
    }
  }
  const args = ['grep', '-l', '-I', '-F', '-z', '--full-name', '-f', '-'];
  if (rev) args.push(rev);
  else if (untracked) args.push('--untracked');
  args.push('--', '.', ...EXCLUDE);
  const r = spawnSync('git', ['-C', root, ...args], { input: tokens.join('\n') + '\n', encoding: 'utf8', maxBuffer: MAX, timeout: SLOW_SEARCH_MS });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter(Boolean).map((f) => (rev && f.startsWith(rev + ':') ? f.slice(rev.length + 1) : f));
}

module.exports = { git, isRepo, defaultBase, mergeBase, listFiles, BlobReader, grepMany, filesWithAny };
