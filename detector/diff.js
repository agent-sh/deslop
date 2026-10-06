'use strict';
// Parse `git diff --unified=0` into per-file added/removed lines and change blocks.

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
      // Fallback for entries with no ---/+++ lines (mode-only changes, empty files).
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
      if (m) { cur.headerOld = m[1]; cur.headerNew = m[2]; }
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
    if (raw.startsWith('rename from ')) { cur.oldPath = raw.slice(12); cur.status = 'R'; continue; }
    if (raw.startsWith('rename to ')) { cur.path = raw.slice(10); continue; }
    if (raw.startsWith('Binary files ')) { cur.binary = true; continue; }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      // git appends a tab after a path that contains a space.
      if (p !== '/dev/null') cur.oldPath = cur.oldPath || p.replace(/\t$/, '').replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') cur.path = p.replace(/\t$/, '').replace(/^b\//, '');
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
      continue;
    }
  }
  for (const f of files) {
    if (!f.path && f.status !== 'D') f.path = f.headerNew;
    if (!f.oldPath) f.oldPath = f.headerOld;
    if (!f.path) f.path = f.oldPath;
    if (!f.oldPath) f.oldPath = f.path;
  }
  return files;
}

module.exports = { parseDiff };
