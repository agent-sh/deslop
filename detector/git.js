'use strict';
// Git access for the detector. Everything reads from a revision (or the work tree with
// rev === null), so the detector never needs a checkout of the commit it inspects.
const fs = require('fs');
const path = require('path');
const { run, installed, MAX } = require('./proc');

// `ok` lists the extra exit statuses that answer the question (rev-parse --verify exits 1 for a
// missing ref); stdout is returned only on success, '' on those.
function git(root, args, { input, ok = [0], timeout, encoding, maxBuffer } = {}) {
  let i = 0;
  while (args[i] === '-c') i += 2;
  const r = run('git', ['-C', root, ...args], { name: `git ${args[i]}`, input, ok, timeout, encoding, maxBuffer });
  return r.status === 0 ? r.stdout : (encoding === 'buffer' ? Buffer.alloc(0) : '');
}

function isRepo(root) {
  // 128 is git's "not a repository"; anything else (no git at all) is still an error.
  return run('git', ['-C', root, 'rev-parse', '--git-dir'], { name: 'git rev-parse', ok: [0, 128] }).status === 0;
}

function defaultBase(root) {
  const head = git(root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { ok: [0, 1] }).trim();
  const candidates = [head, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const c of candidates) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`], { ok: [0, 1] }).trim()) return c;
  }
  return null;
}

function mergeBase(root, a, b) {
  // Exit 1: the two histories share no commit.
  return git(root, ['merge-base', a, b || 'HEAD'], { ok: [0, 1] }).trim() || null;
}

// Tracked paths at rev (or the index when rev is null).
function listFiles(root, rev) {
  const out = rev ? git(root, ['ls-tree', '-r', '--name-only', '-z', rev]) : git(root, ['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

// Missing paths and symlinks (including a symlinked parent) read as null. Detector evidence
// reaches the model, so refuse links outright, just like confirm's context and fix reads.
function readDisk(root, p, read) {
  const file = path.resolve(root, p);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    if (fs.realpathSync(file) !== file) return null;
    return read(file);
  } catch (e) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(e.code)) return null;
    throw e;
  }
}

const textOf = (buf) => (buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8')); // binary reads as unreadable

class BlobReader {
  constructor(root, rev) {
    this.root = fs.realpathSync(root);
    this.rev = rev;
    this.cache = new Map();
  }
  read(p) {
    return this.readMany([p])[0];
  }
  // All blobs in one git process; one spawn per file is too slow for a few thousand files.
  readMany(paths) {
    const want = [...new Set(paths.filter((p) => !this.cache.has(p)))];
    if (want.length && this.rev) {
      const out = git(this.root, ['cat-file', '--batch'], { input: want.map((p) => `${this.rev}:${p}`).join('\n') + '\n', encoding: 'buffer', maxBuffer: 4 * MAX });
      let pos = 0;
      for (const p of want) {
        const nl = out.indexOf(10, pos);
        if (nl < 0) throw new Error(`git cat-file --batch stopped before ${p}`);
        // "<oid> <type> <size>" then the content, or "<name> missing" with none.
        const m = / (\w+) (\d+)$/.exec(out.subarray(pos, nl).toString('utf8'));
        pos = nl + 1;
        if (!m) { this.cache.set(p, null); continue; }
        const size = Number(m[2]);
        this.cache.set(p, m[1] === 'blob' ? textOf(out.subarray(pos, pos + size)) : null);
        pos += size + 1;
      }
    } else {
      for (const p of want) {
        const buf = readDisk(this.root, p, fs.readFileSync);
        this.cache.set(p, buf === null ? null : textOf(buf));
      }
    }
    return paths.map((p) => this.cache.get(p));
  }
  // Byte sizes (null for a missing path) without reading content, so a caller can leave out
  // large files before loading them.
  sizes(paths) {
    if (!paths.length) return [];
    if (this.rev) {
      const lines = git(this.root, ['cat-file', '--batch-check=%(objectsize)'], { input: paths.map((p) => `${this.rev}:${p}`).join('\n') + '\n' }).split('\n');
      return paths.map((_, i) => (/^\d+$/.test(lines[i] || '') ? Number(lines[i]) : null));
    }
    return paths.map((p) => {
      const st = readDisk(this.root, p, fs.statSync);
      return st && st.size;
    });
  }
}

const EXCLUDE_GLOBS = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', '*.min.js', '*.map', 'node_modules/**', 'vendor/**', 'third_party/**', 'dist/**']
  .map((g) => `**/${g}`);
const EXCLUDE = EXCLUDE_GLOBS.map((g) => `:(exclude,glob)${g}`);

// git grep tries every pattern on every line; on a large repo that can take minutes.
const SLOW_SEARCH_MS = 180000;

function haveRg() {
  if (process.env.DESLOP_NO_RG) return false; // force the git grep path (tests, debugging)
  return installed('rg');
}

// ripgrep matches all tokens in one pass (Aho-Corasick); git grep tries each pattern on each
// line, which takes minutes on a large repo with a few hundred tokens. rg reads the work tree,
// so it is used only when the scan targets the checked-out tree. Both exit 1 for no match;
// rg's exit 2 (a file it could not read) means the search is incomplete, so run() throws.
// No per-file match cap: it counts lines across all tokens, so common tokens would hide the
// one line that mentions a rare one.
function search(root, rev, tokens, { list, pathspecs = [], tracked, untracked = false }) {
  const input = tokens.join('\n') + '\n';
  let out;
  let rg = false;
  if (!rev && !pathspecs.length && haveRg()) {
    const args = [list ? '-l' : '-n', '--null', '--no-config', '-F', '--hidden', '--path-separator', '/', '-f', '-', '-g', '!.git'];
    if (!list) args.push('--no-heading', '--with-filename', '-M', '4000');
    for (const g of EXCLUDE_GLOBS) args.push('-g', `!${g}`);
    args.push('.');
    out = run('rg', args, { cwd: root, input, ok: [0, 1] }).stdout;
    rg = true;
  } else {
    const args = ['grep', list ? '-l' : '-n', '-I', '--no-color', '-F', '-z', '--full-name', '-f', '-'];
    if (rev) args.push(rev);
    else if (untracked) args.push('--untracked');
    args.push('--', ...(pathspecs.length ? pathspecs : ['.']), ...EXCLUDE);
    out = git(root, args, { input, ok: [0, 1], timeout: SLOW_SEARCH_MS });
  }
  const clean = (f) => {
    if (rg) f = f.replace(/^\.\//, '');
    else if (rev && f.startsWith(rev + ':')) f = f.slice(rev.length + 1);
    return f;
  };
  // rg searches the work tree, which can hold files git does not track.
  const keep = (f) => !rg || !tracked || tracked.has(f);
  if (list) return out.split('\0').filter(Boolean).map(clean).filter(keep);
  const hits = [];
  // "<file>\0<line>:<text>" from rg, "<file>\0<line>\0<text>" from git grep -z.
  for (const rec of out.split('\n')) {
    const z = rec.indexOf('\0');
    if (z < 0) continue;
    const file = clean(rec.slice(0, z));
    if (!keep(file)) continue;
    const rest = rec.slice(z + 1);
    const c = rg ? rest.indexOf(':') : rest.indexOf('\0');
    if (c < 0) continue;
    const text = rest.slice(c + 1);
    if (rg && text.startsWith('[Omitted long line')) continue;
    hits.push({ file, line: Number(rest.slice(0, c)), text });
  }
  return hits;
}

// Fixed-string search for many tokens at once. Returns [{file, line, text}] for lines holding any token.
function grepMany(root, rev, tokens, opts = {}) {
  return tokens.length ? search(root, rev, tokens, { ...opts, list: false }) : [];
}

// Files holding any of the fixed strings, for narrowing a scan before reading files.
function filesWithAny(root, rev, tokens, opts = {}) {
  return tokens.length ? search(root, rev, tokens, { ...opts, pathspecs: [], list: true }) : [];
}

module.exports = { git, isRepo, defaultBase, mergeBase, listFiles, BlobReader, grepMany, filesWithAny };
