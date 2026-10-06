'use strict';
// Builds the shared context every check reads: the parsed diff, file sets at both ends,
// blob readers, and the PR text (body plus commit messages).
const path = require('path');
const { git, defaultBase, mergeBase, listFiles, BlobReader, grepMany, filesWithAny } = require('./git');
const { parseDiff } = require('./diff');
const { kind, SKIP_KINDS } = require('./files');

function buildContext(root, opts) {
  const ctx = { root, opts, scope: opts.scope };
  ctx.head = opts.worktree ? null : (opts.head || 'HEAD');
  ctx.headFiles = new Set(listFiles(root, ctx.head));
  ctx.headReader = new BlobReader(root, ctx.head);
  ctx.kindOf = (p) => kind(p);
  // Searching a checked-out HEAD reads the work tree (threaded, page cache); any other revision
  // has to decompress every blob, which is slow on large repos.
  const grepRev = ctx.head && ctx.head !== 'HEAD' ? ctx.head : null;
  // In work-tree mode untracked files are part of the change, so the search covers them too.
  ctx.grep = (tokens, o = {}) => grepMany(root, grepRev, tokens, { ...o, tracked: ctx.headFiles, untracked: !ctx.head });
  ctx.filesWith = (tokens) => filesWithAny(root, grepRev, tokens, { tracked: ctx.headFiles, untracked: !ctx.head });
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
    // Fixed a/ b/ prefixes and unquoted paths whatever the user's diff settings are.
    const text = git(root, ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', '-M', ...range]);
    // Binary files have no lines to check, but a deleted or moved one still retires its path.
    ctx.files = parseDiff(text).filter((f) => !f.binary || f.status === 'D' || f.status === 'R');
    ctx.baseFiles = new Set(listFiles(root, mb));
    ctx.baseReader = new BlobReader(root, mb);
    ctx.commits = [];
    if (opts.commitText !== false) {
      // One record per commit: sha, message, and the files that commit changed.
      const log = git(root, ['log', '--no-merges', '--format=%x1e%H%x1f%B', `${mb}..${ctx.head || 'HEAD'}`], { allowFail: true });
      for (const rec of log.split('\x1e').slice(1)) {
        const [sha, message] = rec.split('\x1f');
        ctx.commits.push({ sha, message: (message || '').trim() });
      }
    }
    if (!ctx.head) {
      // Work-tree mode also covers files not yet added to git.
      const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
      for (const p of untracked) {
        ctx.headFiles.add(p);
        const text = ctx.headReader.read(p);
        if (text === null || text.length > 2_000_000) continue;
        const added = text.split('\n').map((t, i) => ({ line: i + 1, text: t }));
        ctx.files.push({ path: p, oldPath: p, status: 'A', added, removed: [], blocks: [{ added, removed: [], newStart: 1 }] });
      }
    }
  } else {
    // Repo scope: every tracked text file counts as fully added, so line checks see all of it.
    const selected = opts.paths && opts.paths.length
      ? [...ctx.headFiles].filter((f) => opts.paths.some((p) => f === p || f.startsWith(p.replace(/\/$/, '') + '/')))
      : [...ctx.headFiles];
    // Lock files, vendored code and recorded data are skipped by every check; on a large repo
    // loading them anyway is most of the memory.
    const wanted = selected.filter((p) => !SKIP_KINDS.has(kind(p)));
    // One git process per chunk of files; one per file takes minutes on a large repository.
    for (let c = 0; c < wanted.length; c += 2000) {
      const chunk = wanted.slice(c, c + 2000);
      const texts = ctx.headReader.readMany(chunk);
      chunk.forEach((p, k) => {
        const text = texts[k];
        if (text === null || text.length > 2_000_000) return;
        const added = text.split('\n').map((t, i) => ({ line: i + 1, text: t }));
        ctx.files.push({ path: p, oldPath: p, status: 'A', added, removed: [], blocks: [{ added, removed: [], newStart: 1 }], whole: true });
      });
    }
    ctx.commits = [];
  }
  for (const f of ctx.headFiles) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) ctx.dirs.add(parts.slice(0, i).join('/'));
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
