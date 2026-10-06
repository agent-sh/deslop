'use strict';
// Parse `git diff --unified=0` into per-file added/removed lines and change blocks.

// git C-quotes a path that holds a tab, newline, quote or backslash ("a/x\ty"), even with
// core.quotepath off. Undo that, and drop the a/ or b/ prefix.
function unquote(p, prefix) {
  let s = p.replace(/\t$/, '');
  if (s.startsWith('"') && s.endsWith('"')) {
    const bytes = [];
    const body = s.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
      const n = body[++i];
      if (/[0-7]/.test(n)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; continue; }
      bytes.push({ t: 9, n: 10, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }[n] ?? n.charCodeAt(0));
    }
    s = Buffer.from(bytes).toString('utf8');
  }
  return prefix && s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

// "diff --git a/x b/y", either side possibly quoted.
function headerPaths(raw) {
  const rest = raw.slice('diff --git '.length);
  const q = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest);
  if (q) return [unquote(q[1], 'a/'), unquote(q[2], 'b/')];
  const m = /^a\/(.+) b\/(.+)$/.exec(rest); // unquoted paths with spaces
  return m ? [m[1], m[2]] : [null, null];
}

function parseDiff(text) {
  const files = [];
  let cur = null;
  let block = null;
  let oldLine = 0;
  let newLine = 0;
  const lines = text.split('\n');
  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      cur = { path: null, oldPath: null, status: 'M', added: [], removed: [], blocks: [], binary: false };
      // Fallback for entries with no ---/+++ lines (binary, mode-only, empty files).
      [cur.headerOld, cur.headerNew] = headerPaths(raw);
      files.push(cur);
      block = null;
      continue;
    }
    if (!cur) continue;
    if (block) {
      if (raw.startsWith('+')) {
        const l = { line: newLine++, text: raw.slice(1) };
        cur.added.push(l);
        block.added.push(l);
        continue;
      }
      if (raw.startsWith('-')) {
        const l = { line: oldLine++, text: raw.slice(1) };
        cur.removed.push(l);
        block.removed.push(l);
        continue;
      }
    }
    if (raw.startsWith('new file mode')) { cur.status = 'A'; continue; }
    if (raw.startsWith('deleted file mode')) { cur.status = 'D'; continue; }
    if (raw.startsWith('rename from ')) { cur.oldPath = unquote(raw.slice(12)); cur.status = 'R'; continue; }
    if (raw.startsWith('rename to ')) { cur.path = unquote(raw.slice(10)); continue; }
    if (raw.startsWith('Binary files ')) { cur.binary = true; continue; }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') cur.oldPath = cur.oldPath || unquote(p, 'a/');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') cur.path = unquote(p, 'b/');
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[3]);
      // With --unified=0 a pure insertion reports the line before it as the old start.
      if (h[2] === '0') oldLine += 1;
      if (h[4] === '0') newLine += 1;
      block = { removed: [], added: [], newStart: newLine, oldStart: oldLine };
      cur.blocks.push(block);
    }
  }
  for (const f of files) {
    if (!f.path && f.status !== 'D') f.path = f.headerNew;
    if (!f.oldPath) f.oldPath = f.headerOld;
    if (!f.path) f.path = f.oldPath;
  }
  // An entry whose path could not be read is skipped rather than allowed to crash a check.
  return files.filter((f) => typeof f.path === 'string' && f.path);
}

module.exports = { parseDiff };
