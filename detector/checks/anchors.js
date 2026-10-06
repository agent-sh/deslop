'use strict';
// Markdown links to a heading that does not exist (renamed or removed sections).
const { SKIP_KINDS, TEXT_KINDS } = require('../files');

const LINK = /\]\(([^)\s#]*)#([^)\s]+)\)/g;

// GitHub's heading slug: lower-case, drop punctuation except - and _, spaces to -.
function slug(h) {
  return h.trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, (c) => (c === '_' ? '_' : ''))
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(text) {
  const out = new Set();
  const counts = new Map();
  let fence = false;
  for (const ln of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    if (fence) continue;
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(ln);
    if (m) {
      const s = slug(m[1]);
      const n = counts.get(s) || 0;
      counts.set(s, n + 1);
      out.add(n ? `${s}-${n}` : s);
    }
    for (const a of ln.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/g)) out.add(a[1]);
  }
  return out;
}

module.exports = {
  id: 'anchors',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    const cache = new Map();
    const anchors = (p) => {
      if (!cache.has(p)) {
        const t = ctx.headReader.read(p);
        cache.set(p, t === null ? null : anchorsOf(t));
      }
      return cache.get(p);
    };
    // Links added by the change, plus links anywhere into a doc whose headings the change edited.
    const editedHeadings = new Set(ctx.files.filter((f) => /\.mdx?$/.test(f.path) && [...f.added, ...f.removed].some((l) => /^\s{0,3}#{1,6}\s/.test(l.text))).map((f) => f.path));
    const sources = [];
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind) || !(TEXT_KINDS.has(f.kind) || /\.mdx?$/.test(f.path))) continue;
      for (const a of f.added) sources.push({ file: f.path, line: a.line, text: a.text });
    }
    if (ctx.scope === 'diff' && editedHeadings.size) {
      for (const h of ctx.grep(['#'])) {
        if (!/\.mdx?$/.test(h.file) || !/\]\([^)]*#/.test(h.text)) continue;
        sources.push({ file: h.file, line: h.line, text: h.text, inbound: true });
      }
    }
    const seen = new Set();
    for (const s of sources) {
      for (const m of s.text.matchAll(LINK)) {
        const target = m[1] ? ctx.rel(s.file, decodeURIComponent(m[1])) : s.file;
        if (m[1] && /^[a-z]+:/i.test(m[1])) continue;
        if (s.inbound && !editedHeadings.has(target)) continue;
        if (!/\.mdx?$/.test(target)) continue;
        const set = anchors(target);
        if (!set) continue; // missing file is the refs check's job
        const frag = decodeURIComponent(m[2]).toLowerCase();
        if (set.has(frag) || /^(l\d+|user-content-)/.test(frag)) continue;
        const key = `${s.file}:${s.line}:${frag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ check: 'broken-anchor', severity: 'high', file: s.file, line: s.line, excerpt: s.text.trim().slice(0, 160), message: `links to #${m[2]} in ${target === s.file ? 'this file' : target}, but no heading there has that anchor`, token: `${target}#${frag}` });
      }
    }
    return items;
  },
};
