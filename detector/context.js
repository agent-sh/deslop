'use strict';
// Builds the shared context every check reads: the parsed diff, file sets at both ends,
// blob readers, and the PR text (body plus commit messages).
const path = require('path');
const { git, defaultBase, mergeBase, listFiles, BlobReader, grepMany } = require('./git');
const { parseDiff } = require('./diff');
const { kind } = require('./files');

function buildContext(root, opts) {
  const ctx = { root, opts, scope: opts.scope };
  ctx.head = opts.worktree ? null : (opts.head || 'HEAD');
  ctx.headFiles = new Set(listFiles(root, ctx.head));
  ctx.headReader = new BlobReader(root, ctx.head);
  ctx.kindOf = (p) => kind(p);
  // Searching a checked-out HEAD reads the work tree (threaded, page cache); any other revision
  // has to decompress every blob, which is slow on large repos.
  const grepRev = ctx.head && ctx.head !== 'HEAD' ? ctx.head : null;
  ctx.grep = (tokens, o = {}) => grepMany(root, grepRev, tokens, { ...o, tracked: ctx.headFiles });
  ctx.dirs = new Set();
  for (const f of ctx.headFiles) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) ctx.dirs.add(parts.slice(0, i).join('/'));
  }
  ctx.exists = (p) => ctx.headFiles.has(p) || ctx.dirs.has(p.replace(/\/$/, ''));
  ctx.files = [];
  ctx.prText = opts.prText || '';
  if (opts.scope === 'diff') {
    const baseRef = opts.base || defaultBase(root);
    if (!baseRef) throw new Error('no base branch found; pass --base');
    const mb = mergeBase(root, baseRef, ctx.head || 'HEAD');
    if (!mb) throw new Error(`no merge base between ${baseRef} and ${ctx.head || 'HEAD'}`);
    ctx.base = mb;
    ctx.baseRef = baseRef;
    const range = ctx.head ? [mb, ctx.head] : [mb];
    const text = git(root, ['diff', '--no-color', '--no-ext-diff', '--unified=0', '-M', ...range]);
    ctx.files = parseDiff(text).filter((f) => !f.binary);
    ctx.baseFiles = new Set(listFiles(root, mb));
    ctx.baseReader = new BlobReader(root, mb);
    if (opts.commitText !== false && ctx.head) {
      ctx.commitText = git(root, ['log', '--format=%B%n', `${mb}..${ctx.head}`], { allowFail: true });
    } else {
      ctx.commitText = '';
    }
  } else {
    // Repo scope: every tracked text file counts as fully added, so line checks see all of it.
    const selected = opts.paths && opts.paths.length
      ? [...ctx.headFiles].filter((f) => opts.paths.some((p) => f === p || f.startsWith(p.replace(/\/$/, '') + '/')))
      : [...ctx.headFiles];
    for (const p of selected) {
      const k = kind(p);
      if (k === 'lock' || k === 'vendor') continue;
      const text = ctx.headReader.read(p);
      if (text === null || text.length > 2_000_000) continue;
      const added = text.split('\n').map((t, i) => ({ line: i + 1, text: t }));
      ctx.files.push({ path: p, oldPath: p, status: 'A', added, removed: [], blocks: [{ added, removed: [], newStart: 1 }], whole: true });
    }
    ctx.commitText = '';
  }
  ctx.touched = new Set();
  for (const f of ctx.files) { ctx.touched.add(f.path); if (f.oldPath) ctx.touched.add(f.oldPath); }
  for (const f of ctx.files) f.kind = kind(f.path);
  ctx.lines = (p) => {
    const t = ctx.headReader.read(p);
    return t === null ? null : t.split('\n');
  };
  ctx.rel = (from, p) => path.posix.normalize(path.posix.join(path.posix.dirname(from), p));
  return ctx;
}

module.exports = { buildContext };
