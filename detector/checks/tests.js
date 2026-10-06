'use strict';
// Tests that cannot fail: no assertion, failures swallowed, or a script that always reports success.
const { lang } = require('../files');

const ASSERT = {
  js: /\b(expect|assert(\.\w+)?|should|t\.(is|ok|equal|deepEqual|throws|true|false|fail|plan|snapshot|not\w*|regex)|chai|sinon\.assert)\b|\.(toBe|toEqual|toThrow|rejects|resolves)\b/,
  py: /\b(assert|self\.assert\w*|pytest\.(raises|fail|approx)|self\.fail|raise)\b/,
  rust: /\b(assert(_eq|_ne)?!|debug_assert\w*!|panic!|unreachable!|\.unwrap\(\)|\.expect\(|matches!|\?\s*;|bail!|ensure!)/,
  go: /\b(t\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)|assert\.|require\.)/,
};
const TEST_START = {
  js: /^\s*(?:it|test)(?:\.(?:only|concurrent))?\s*\(\s*['"`]/,
  py: /^(\s*)(?:async\s+)?def\s+(test_\w*)\s*\(/,
  rust: /^\s*#\[(?:tokio::)?test\b/,
  go: /^func\s+(Test\w+)\s*\(\s*t\s+\*testing\.T/,
};
const SWALLOW = /\|\|\s*true\b|2>\s*\/dev\/null|set \+e\b|except(\s+\w+(\s+as\s+\w+)?)?\s*:\s*pass\b|catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/;
const SH_PASS = /\b(PASS(ED)?|GREEN|OK|SUCCESS|all (tests )?pass(ed)?)\b/;
// Ways a shell test can go red: an explicit failing exit, errexit in any spelling, a fail
// helper, or a success marker printed only after a command chain succeeds.
const SH_FAIL = /\bexit\s+("?\$|[1-9])|\breturn\s+[1-9]|\b(fail|die|abort)\s*\(|\b(fail|die)\b\s|set\s+-[a-z]*e|set\s+-o\s+errexit|^#!.*\s-[a-z]*e\b|\bfalse\b|\[\[?.*\]\]?\s*\|\|\s*exit|&&\s*(echo|printf)\b[^\n]*\b(PASS|OK|GREEN|SUCCESS)/m;

// Body of a test that starts at index i (0-based) in lines, by brace or indentation.
function body(lines, i, l) {
  if (l === 'py') {
    const indent = /^(\s*)/.exec(lines[i])[1].length;
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (ln.trim() && /^(\s*)/.exec(ln)[1].length <= indent) break;
      out.push(ln);
    }
    return out.join('\n');
  }
  let depth = 0;
  let started = false;
  const out = [];
  for (let j = i; j < lines.length && j < i + 400; j++) {
    const ln = lines[j].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    for (const c of ln) {
      if (c === '{') { depth++; started = true; }
      if (c === '}') depth--;
    }
    out.push(lines[j]);
    if (started && depth <= 0) break;
  }
  return out.join('\n');
}

module.exports = {
  id: 'tests',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    for (const f of ctx.files) {
      if (f.kind !== 'test') continue;
      const l = lang(f.path);
      const lines = ctx.lines(f.path);
      if (!lines) continue;
      const addedLines = new Set(f.added.map((a) => a.line));
      if (l === 'sh' && (f.status === 'A' || f.whole)) {
        const all = lines.join('\n');
        if (SH_PASS.test(all) && !SH_FAIL.test(all)) {
          items.push({ check: 'test-cannot-fail', severity: 'high', file: f.path, line: 1, excerpt: '(whole script)', message: 'prints a success marker but has no failing exit path (no exit 1, set -e or fail helper)' });
        }
      }
      if (TEST_START[l] && ASSERT[l]) {
        const helpers = new Set();
        for (const ln of lines) {
          const m = /^\s*(?:async\s+)?(?:def|function|fn)\s+([A-Za-z_]\w*)/.exec(ln) || /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(ln);
          if (m && !/^test/i.test(m[1])) helpers.add(m[1]);
        }
        for (let i = 0; i < lines.length; i++) {
          if (!addedLines.has(i + 1) || !TEST_START[l].test(lines[i])) continue;
          let start = i;
          if (l === 'rust') {
            while (start < lines.length && !/\bfn\s+\w+/.test(lines[start])) start++;
            if (/#\[should_panic/.test(lines.slice(i, start + 1).join('\n'))) continue;
          }
          const b = body(lines, start, l);
          if (ASSERT[l].test(b.split('\n').slice(l === 'py' ? 0 : 1).join('\n'))) continue;
          // A helper may assert for the test: a call to a checker-named function or to any
          // function this file defines counts.
          if (/\b(check|verify|expect|assert|ensure|validate|fail)\w*\s*\(/i.test(b)) continue;
          const inner = b.split('\n').slice(1).join('\n');
          if ([...helpers].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(inner))) continue;
          items.push({ check: 'test-cannot-fail', severity: 'high', file: f.path, line: i + 1, excerpt: lines[i].trim().slice(0, 160), message: 'test has no assertion, so it passes whatever the code does' });
        }
      }
      for (const a of f.added) {
        const code = a.text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
        if (SWALLOW.test(code) && !/^\s*(#|\/\/)/.test(a.text)) {
          items.push({ check: 'test-swallows-failure', severity: 'review', file: f.path, line: a.line, excerpt: a.text.trim().slice(0, 160), message: 'test code discards a failure or its error output; check the test can still go red' });
        }
      }
    }
    return items;
  },
};
