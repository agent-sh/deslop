'use strict';
// Functions this change made hard to follow: longer than 80 lines, control flow nested more
// than 5 deep, or more than 6 parameters. Only functions the change added or edited, and only
// when the change is what crossed the line: a function that was already long is not news.
const { lang, SNAPSHOT } = require('../files');
const { functions, nesting, isGenerated, testCutoff } = require('../code');

const MAX_LINES = 80;
const MAX_DEPTH = 5;
const MAX_PARAMS = 6;
const SUPPORTED = new Set(['js', 'py', 'rust', 'go', 'sh']);
const MAX_FILE = 1024 * 1024;
// Rust unit tests often live in src/tests.rs, which the file kinds do not call a test.
const RUST_TESTS = /(^|\/)tests?\.rs$/;

function measure(text, l) {
  const { fns, lexed } = functions(text, l);
  const lines = text.split('\n');
  const cutoff = testCutoff(text, l);
  return fns
    .filter((fn) => fn.start < cutoff && !(l === 'py' && /^test_/.test(fn.name)))
    .map((fn) => {
      let length = 0;
      for (let ln = fn.start; ln <= fn.end; ln++) if ((lines[ln - 1] || '').trim()) length++;
      return { ...fn, length, depth: nesting(fn, text, l, lexed) };
    });
}

module.exports = {
  id: 'complexity',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    for (const f of ctx.files) {
      const l = lang(f.path);
      if (f.kind !== 'code' || f.status === 'D' || !SUPPORTED.has(l) || !f.added.length || RUST_TESTS.test(f.path) || SNAPSHOT.test(f.path)) continue;
      const text = ctx.headReader.read(f.path);
      if (text === null || text.length > MAX_FILE || isGenerated(text)) continue;
      const added = new Set(f.added.map((a) => a.line));
      // The same function before the change, by name: the worst value any of them had.
      const before = new Map();
      const baseText = f.status !== 'A' && ctx.baseReader ? ctx.baseReader.read(f.oldPath) : null;
      if (baseText !== null && baseText.length <= MAX_FILE) {
        for (const fn of measure(baseText, l)) {
          const b = before.get(fn.name) || { length: 0, depth: 0, params: 0 };
          before.set(fn.name, { length: Math.max(b.length, fn.length), depth: Math.max(b.depth, fn.depth.max), params: Math.max(b.params, fn.params) });
        }
      }
      const file = text.split('\n');
      let reported = 0;
      for (const fn of measure(text, l)) {
        let touched = false;
        for (let ln = fn.start; ln <= fn.end && !touched; ln++) touched = added.has(ln);
        if (!touched) continue;
        const was = before.get(fn.name) || { length: 0, depth: 0, params: 0 };
        const why = [];
        if (fn.length > MAX_LINES && was.length <= MAX_LINES) why.push(`is ${fn.length} lines long`);
        if (fn.depth.max > MAX_DEPTH && was.depth <= MAX_DEPTH && added.has(fn.depth.at)) why.push(`nests control flow ${fn.depth.max} deep (line ${fn.depth.at})`);
        let signatureEdited = false;
        for (let ln = fn.start; ln < Math.max(fn.bodyStart, fn.start + 1) && !signatureEdited; ln++) signatureEdited = added.has(ln);
        if (fn.params > MAX_PARAMS && was.params <= MAX_PARAMS && signatureEdited) why.push(`takes ${fn.params} parameters`);
        if (!why.length || ++reported > 3) continue;
        items.push({
          check: 'complexity',
          severity: 'review',
          file: f.path,
          line: fn.start,
          excerpt: (file[fn.start - 1] || '').trim().slice(0, 160),
          message: `\`${fn.name}\` ${why.join(', ')} after this change (limits: ${MAX_LINES} lines, ${MAX_DEPTH} levels, ${MAX_PARAMS} parameters); split it into named steps or pass an options object`,
          token: fn.name,
        });
      }
    }
    return items;
  },
};
