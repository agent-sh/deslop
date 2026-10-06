'use strict';
// A small lexer and function finder for the code-shape checks (duplicate-code, complexity).
// It knows just enough of each language to drop comments, keep string contents from looking
// like code, and match braces; it is not a parser.

const KEYWORDS = new Set(('if else for while do switch case default break continue return try catch finally throw '
  + 'function class const let var new delete typeof instanceof in of void yield await async static get set '
  + 'import export from as extends super this null undefined true false def elif except pass raise with lambda '
  + 'global nonlocal assert del not and or is None True False fn let mut impl struct enum trait pub use mod '
  + 'crate self Self match loop where type unsafe move ref dyn func package go defer chan select range map '
  + 'interface then fi done esac local echo printf').split(' '));

// A literal regex can follow these; a division follows a value.
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

const isIdStart = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36;
const isIdChar = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;

// Tokens of a source text: [{v, line}], identifiers as written, every string, number and
// regex literal as one placeholder token, comments and whitespace dropped. `opens[i]` is the
// bracket depth at the start of line i+1 and `inString` holds lines that start inside a
// multi-line string or heredoc, which the indentation-based logic must skip.
class Lexer {
  constructor(text, l) {
    this.text = text;
    this.l = l;
    this.n = text.length;
    this.i = 0;
    this.line = 1;
    this.depth = 0;
    this.toks = [];
    this.opens = [0];
    this.inString = new Set();
    this.heredoc = null;
    this.hashComments = l === 'py' || l === 'sh' || l === 'hash';
  }

  push(v) { this.toks.push({ v, line: this.line }); }

  newline(insideString = false) {
    this.line++;
    this.opens.push(this.depth);
    if (insideString) this.inString.add(this.line);
  }

  run() {
    while (this.i < this.n) {
      const ch = this.text[this.i];
      if (ch === '\n') { this.newline(); this.i++; if (this.heredoc) this.skipHeredoc(); continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { this.i++; continue; }
      if (this.comment(ch) || this.literal(ch) || this.word()) continue;
      if ('([{'.includes(ch)) this.depth++;
      else if (')]}'.includes(ch)) this.depth = Math.max(0, this.depth - 1);
      this.push(ch);
      this.i++;
    }
    return { toks: this.toks, opens: this.opens, inString: this.inString, lines: this.line };
  }

  comment(ch) {
    const { text, i } = this;
    if (this.hashComments && ch === '#') {
      // In shell, # starts a comment only at the start of a word: ${#x} and ${x#y} are code.
      const prev = text[i - 1];
      if (this.l !== 'sh' || prev === undefined || prev === ' ' || prev === '\t' || prev === '\n' || prev === ';') {
        while (this.i < this.n && text[this.i] !== '\n') this.i++;
        return true;
      }
    }
    if (this.hashComments || ch !== '/') return false;
    if (text[i + 1] === '/') {
      while (this.i < this.n && text[this.i] !== '\n') this.i++;
      return true;
    }
    if (text[i + 1] === '*') {
      this.i += 2;
      while (this.i < this.n && !(text[this.i] === '*' && text[this.i + 1] === '/')) {
        if (text[this.i] === '\n') this.newline();
        this.i++;
      }
      this.i += 2;
      return true;
    }
    return false;
  }

  // Strings, chars, raw strings, template literals, regexes, heredoc starts and numbers.
  literal(ch) {
    const { l } = this;
    if (l === 'py' && (ch === '"' || ch === "'")) {
      const triple = this.text.startsWith(ch.repeat(3), this.i);
      this.i = this.skipString(this.i + (triple ? 3 : 1), ch, { triple });
    } else if (l === 'rust' && ch === 'r' && this.rawString()) {
      // consumed by rawString
    } else if (l === 'rust' && ch === "'") {
      // A char literal ('a', '\n', '{') or a lifetime ('a, 'static), which is skipped.
      const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(this.text.slice(this.i, this.i + 14));
      if (!m) { this.i++; return true; }
      this.i += m[0].length;
    } else if (l === 'js' && ch === '`') {
      this.template();
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const raw = (l === 'go' && ch === '`') || (l === 'sh' && ch === "'");
      this.i = this.skipString(this.i + 1, ch, { escapes: !raw });
    } else if (l === 'js' && ch === '/' && this.regex()) {
      // consumed by regex
    } else if (l === 'sh' && ch === '<' && this.heredocStart()) {
      return true;
    } else if (isDigit(this.text.charCodeAt(this.i))) {
      let j = this.i + 1;
      while (j < this.n && (isIdChar(this.text.charCodeAt(j)) || (this.text[j] === '.' && isDigit(this.text.charCodeAt(j + 1))))) j++;
      this.i = j;
      this.push('0');
      return true;
    } else {
      return false;
    }
    this.push('""');
    return true;
  }

  word() {
    const c = this.text.charCodeAt(this.i);
    if (!isIdStart(c) || (c === 36 && this.l !== 'js')) return false;
    let j = this.i + 1;
    while (j < this.n && isIdChar(this.text.charCodeAt(j))) j++;
    const word = this.text.slice(this.i, j);
    this.i = j;
    // String prefixes (r"..", b"..", f"..", rb"..") belong to the string that follows.
    const next = this.text[j];
    const prefix = (this.l === 'py' || this.l === 'rust') && /^(r|b|f|u|rb|br|fr|rf)$/i.test(word) && (next === '"' || (this.l === 'py' && next === "'"));
    if (!prefix) this.push(word);
    return true;
  }

  // Skip a quoted string that may span lines; returns the index after the closing quote.
  skipString(start, quote, { escapes = true, triple = false } = {}) {
    const { text, l } = this;
    const multiline = triple || quote === '`' || l === 'sh' || l === 'rust' || l === 'go';
    let j = start;
    while (j < this.n) {
      const c = text[j];
      if (c === '\n') {
        if (!multiline) return j; // unterminated: stop at the end of the line
        this.newline(true);
        j++;
        continue;
      }
      if (escapes && c === '\\') { j += 2; continue; }
      if (triple ? text.startsWith(quote.repeat(3), j) : c === quote) return j + (triple ? 3 : 1);
      j++;
    }
    return this.n;
  }

  rawString() {
    const m = /^r(#*)"/.exec(this.text.slice(this.i, this.i + 8));
    if (!m || isIdChar(this.text.charCodeAt(this.i - 1))) return false;
    const close = '"' + m[1];
    let j = this.text.indexOf(close, this.i + m[0].length);
    if (j < 0) j = this.n;
    for (let k = this.i; k < j; k++) if (this.text[k] === '\n') this.newline(true);
    this.i = j + close.length;
    return true;
  }

  // Template literal: ${...} parts are code but their braces balance, so skip them whole.
  template() {
    const { text } = this;
    let j = this.i + 1;
    let sub = 0;
    while (j < this.n) {
      const d = text[j];
      if (d === '\n') { this.newline(true); j++; continue; }
      if (d === '\\') { j += 2; continue; }
      if (d === '$' && text[j + 1] === '{') { sub++; j += 2; continue; }
      if (d === '}' && sub > 0) { sub--; j++; continue; }
      if (d === '`' && sub === 0) { j++; break; }
      j++;
    }
    this.i = j;
  }

  regex() {
    const prev = this.toks.length ? this.toks[this.toks.length - 1].v : '(';
    if (!REGEX_PREV.has(prev)) return false;
    const { text } = this;
    let j = this.i + 1;
    let cls = false;
    while (j < this.n && text[j] !== '\n') {
      const d = text[j];
      if (d === '\\') { j += 2; continue; }
      if (d === '[') cls = true;
      else if (d === ']') cls = false;
      else if (d === '/' && !cls) break;
      j++;
    }
    if (text[j] !== '/') return false;
    j++;
    while (j < this.n && isIdChar(text.charCodeAt(j))) j++;
    this.i = j;
    return true;
  }

  heredocStart() {
    if (this.text[this.i + 1] !== '<' || this.text[this.i + 2] === '<') return false;
    const m = /^<<(-?)\s*(['"]?)([A-Za-z_][\w]*)\2/.exec(this.text.slice(this.i, this.i + 80));
    if (!m) return false;
    this.heredoc = { tag: m[3], strip: m[1] === '-' };
    this.i += m[0].length;
    this.push('<<');
    return true;
  }

  // Heredoc bodies are data: skip to the terminator line.
  skipHeredoc() {
    const { text } = this;
    while (this.i < this.n) {
      const end = text.indexOf('\n', this.i);
      const ln = text.slice(this.i, end < 0 ? this.n : end);
      this.inString.add(this.line);
      this.i = end < 0 ? this.n : end;
      if ((this.heredoc.strip ? ln.trim() : ln) === this.heredoc.tag) break;
      if (this.i < this.n) { this.newline(); this.i++; }
    }
    this.heredoc = null;
  }
}

const lex = (text, l) => new Lexer(text, l).run();

const BRACE_LANGS = new Set(['js', 'rust', 'go', 'sh']);
const CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'match', 'loop', 'select', 'until', 'case', 'with', 'elif', 'except']);
// In brace languages a case label does not open a block of its own.
const BLOCK_CONTROL = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'match', 'loop', 'select']);
// Words that look like a call before a brace but are statements, not method names.
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'match', 'loop', 'else', 'do', 'try', 'typeof', 'new', 'await', 'yield', 'super', 'import', 'export', 'class', 'const', 'let', 'var', 'delete', 'void', 'in', 'of', 'instanceof', 'throw', 'case', 'default', 'break', 'continue', 'then', 'fi', 'done', 'esac', 'elif', 'until', 'local', 'echo', 'printf', 'test', 'exit', 'set', 'unset', 'source', 'eval', 'exec', 'trap', 'shift', 'read', 'cd']);
const MODIFIERS = new Set(['async', 'static', 'get', 'set', 'public', 'private', 'protected', 'readonly', 'override', 'export', 'default', 'abstract', 'pub', 'unsafe', 'const', 'extern']);
const isName = (v) => /^[A-Za-z_$]/.test(v) && !NOT_A_NAME.has(v);
const indentOf = (s) => /^[ \t]*/.exec(s)[0].replace(/\t/g, '    ').length;

// Index of the token that closes the bracket opened at toks[i].
function matching(toks, i) {
  const open = toks[i].v;
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].v === open) d++;
    else if (toks[j].v === close && --d === 0) return j;
  }
  return toks.length - 1;
}

// Parameters between toks[open] '(' and its ')': top-level commas, ignoring self and this.
function paramCount(toks, open, close, l) {
  if (close <= open + 1) return 0;
  const parts = [[]];
  let d = 0;
  for (let j = open + 1; j < close; j++) {
    const v = toks[j].v;
    const arrow = toks[j - 1].v === '=' || toks[j - 1].v === '-';
    if (v === '(' || v === '[' || v === '{' || (v === '<' && l !== 'py')) d++;
    else if (v === ')' || v === ']' || v === '}' || (v === '>' && l !== 'py' && !arrow)) d = Math.max(0, d - 1);
    if (v === ',' && d === 0) parts.push([]);
    else parts[parts.length - 1].push(v);
  }
  return parts.filter((p) => {
    const words = p.filter((v) => !['&', 'mut', '*', '/'].includes(v));
    if (!words.length) return false;
    return !['self', 'this', 'cls'].includes(words[0]) || words.length > 2;
  }).length;
}

// Python: def name(...): and the indented block under it.
function pyFunctions(text, lexed) {
  const { toks } = lexed;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].v !== 'def' || !toks[i + 1] || toks[i + 2]?.v !== '(') continue;
    const close = matching(toks, i + 2);
    let colon = close + 1;
    while (colon < toks.length && toks[colon].v !== ':') colon++;
    const start = toks[i].line;
    const headerEnd = toks[Math.min(colon, toks.length - 1)].line;
    const indent = indentOf(lines[start - 1] || '');
    let end = headerEnd;
    for (let ln = headerEnd + 1; ln <= lines.length; ln++) {
      const s = lines[ln - 1];
      if (!s.trim()) continue;
      const logical = !lexed.inString.has(ln) && (lexed.opens[ln - 1] || 0) === 0;
      if (logical && indentOf(s) <= indent) break;
      end = ln;
    }
    out.push({ name: toks[i + 1].v, start, end, params: paramCount(toks, i + 2, close, 'py'), bodyStart: headerEnd + 1 });
  }
  return out;
}

// Where a function's name and parameter list are, when toks[i] starts a definition:
// {nameIdx, paren} with paren -2 for a shell function without parentheses, or null.
function signatureAt(toks, i, l) {
  const v = toks[i].v;
  if ((l === 'rust' && v === 'fn') || (l === 'js' && v === 'function') || (l === 'go' && v === 'func') || (l === 'sh' && v === 'function')) {
    let j = i + 1;
    let nameIdx = -1;
    if (l === 'go' && toks[j]?.v === '(') j = matching(toks, j) + 1; // method receiver
    if (l === 'js' && toks[j]?.v === '*') j++;
    if (toks[j] && isName(toks[j].v)) { nameIdx = j; j++; }
    if (l === 'rust' && toks[j]?.v === '<') { let d = 0; for (; j < toks.length; j++) { if (toks[j].v === '<') d++; if (toks[j].v === '>' && --d === 0) { j++; break; } } }
    if (nameIdx < 0 && l === 'js') {
      // const name = function (...) / name: function (...)
      const back = toks[i - 1]?.v === 'async' ? i - 2 : i - 1;
      if (toks[back] && (toks[back].v === '=' || toks[back].v === ':') && toks[back - 1] && /^[A-Za-z_$]/.test(toks[back - 1].v)) nameIdx = back - 1;
    }
    if (nameIdx < 0) return null;
    if (toks[j]?.v === '(') return { nameIdx, paren: j };
    return l === 'sh' && toks[j]?.v === '{' ? { nameIdx, paren: -2 } : null;
  }
  if (isName(v) && toks[i + 1]?.v === '(' && (l === 'js' || l === 'sh')) {
    // Method shorthand (name(...) {) or a shell function (name() {).
    const prev = toks[i - 1]?.v;
    const atStart = l === 'sh' || prev === undefined || prev === '{' || prev === '}' || prev === ';' || prev === ',' || MODIFIERS.has(prev);
    if (!atStart) return null;
    const close = matching(toks, i + 1);
    let k = close + 1;
    if (l === 'js' && toks[k]?.v === ':') while (k < toks.length && toks[k].v !== '{' && toks[k].v !== ';') k++; // return type
    const body = toks[k]?.v === '{' && (l === 'js' ? toks[k].line - toks[close].line <= 1 : close === i + 2);
    return body ? { nameIdx: i, paren: i + 1 } : null;
  }
  if (l === 'js' && (v === 'const' || v === 'let' || v === 'var') && toks[i + 2]?.v === '=') {
    // const name = (...) => { ... }
    let j = i + 3;
    if (toks[j]?.v === 'async') j++;
    if (toks[j]?.v === '(' && toks[matching(toks, j) + 1]?.v === '=' && toks[matching(toks, j) + 2]?.v === '>') return { nameIdx: i + 1, paren: j };
  }
  return null;
}

// JS, Rust, Go and shell: a named definition and the braces of its body.
function braceFunctions(lexed, l) {
  const { toks } = lexed;
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const sig = signatureAt(toks, i, l);
    if (!sig) continue;
    const { nameIdx, paren } = sig;
    const close = paren >= 0 ? matching(toks, paren) : nameIdx;
    // The body brace: the first { after the signature, before a ; that would end a declaration.
    let b = close + 1;
    while (b < toks.length && toks[b].v !== '{' && toks[b].v !== ';' && b - close < 200) {
      if (toks[b].v === '(') b = matching(toks, b);
      b++;
    }
    if (toks[b]?.v !== '{') continue;
    const end = matching(toks, b);
    out.push({ name: toks[nameIdx].v, start: Math.min(toks[i].line, toks[nameIdx].line), end: toks[end].line, params: paren >= 0 ? paramCount(toks, paren, close, l) : 0, bodyStart: toks[b].line, open: b, close: end });
    if (paren >= 0) i = paren;
  }
  return out;
}

// Named functions of a file: {fns: [{name, start, end, params, bodyStart}], lexed}, 1-based lines.
function functions(text, l) {
  const lexed = lex(text, l);
  if (l === 'py') return { fns: pyFunctions(text, lexed), lexed };
  return { fns: BRACE_LANGS.has(l) ? braceFunctions(lexed, l) : [], lexed };
}

// Entries are control statements or nested defs; a nested def starts its own count, as
// ESLint's max-depth does, since it is measured as a function of its own.
function pyNesting(fn, text, lexed) {
  const lines = text.split('\n');
  const stack = [];
  let max = 0;
  let at = fn.start;
  for (let ln = fn.bodyStart; ln <= fn.end; ln++) {
    const s = lines[ln - 1];
    if (!s || !s.trim() || lexed.inString.has(ln) || (lexed.opens[ln - 1] || 0) > 0) continue;
    const ind = indentOf(s);
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    let d = 0;
    for (let k = stack.length - 1; k >= 0 && stack[k].control; k--) d++;
    if (d > max) { max = d; at = ln; }
    const first = /^\s*(async\s+)?([a-z]+)\b/.exec(s);
    if (first && first[2] === 'def') stack.push({ ind, control: false });
    else if (first && CONTROL.has(first[2]) && /:\s*(#.*)?$/.test(s)) stack.push({ ind, control: true });
  }
  return { max, at };
}

// Shell: if/for/while/until/case at the start of a statement open a level; fi/done/esac close it.
function shNesting(fn, toks) {
  let d = 0;
  let max = 0;
  let at = fn.start;
  let lastLine = 0;
  for (let j = fn.open; j <= fn.close; j++) {
    const t = toks[j];
    const start = t.line !== lastLine || [';', '&', '|', '(', '{', 'then', 'do', 'else'].includes(toks[j - 1]?.v);
    lastLine = t.line;
    if (!start) continue;
    if (['if', 'for', 'while', 'until', 'case'].includes(t.v)) { d++; if (d > max) { max = d; at = t.line; } }
    else if (['fi', 'done', 'esac'].includes(t.v)) d = Math.max(0, d - 1);
  }
  return { max, at };
}

// What an open brace at toks[j] belongs to: a control block, a nested function body (which
// restarts the count) or anything else (an object, a plain block), which does not count.
function braceKind(toks, j, from, l) {
  for (let k = j - 1; k > from && j - k < 200; k--) {
    const w = toks[k].v;
    if (w === ')') { // a condition, a for header or a parameter list: jump to its opening paren
      let pd = 0;
      for (; k > from; k--) { if (toks[k].v === ')') pd++; else if (toks[k].v === '(' && --pd === 0) break; }
      continue;
    }
    // Go puts a statement before the condition: if err := f(); err != nil {
    if ((w === ';' && l !== 'go') || w === '{' || w === '}') return 'other';
    // => opens an arrow function in JS; in Rust it opens a match arm, which is not a level.
    if (w === '=' && toks[k + 1]?.v === '>') return l === 'js' ? 'fn' : 'other';
    if (w === 'function' || w === 'func' || w === 'fn') return 'fn';
    if (BLOCK_CONTROL.has(w)) return 'control';
  }
  return 'other';
}

// Deepest control-flow nesting inside a function and the line where it is reached.
function nesting(fn, text, l, lexed) {
  if (l === 'py') return pyNesting(fn, text, lexed);
  const { toks } = lexed;
  if (l === 'sh') return shNesting(fn, toks);
  const stack = [];
  let d = 0;
  let max = 0;
  let at = fn.start;
  for (let j = fn.open + 1; j < fn.close; j++) {
    const v = toks[j].v;
    if (v === '{') {
      const kind = braceKind(toks, j, fn.open, l);
      stack.push({ kind, saved: d });
      if (kind === 'fn') d = 0;
      if (kind === 'control') { d++; if (d > max) { max = d; at = toks[j].line; } }
    } else if (v === '}') {
      const top = stack.pop();
      if (top && top.kind === 'control') d--;
      if (top && top.kind === 'fn') d = top.saved;
    }
  }
  return { max, at };
}

const GENERATED = /@generated|DO NOT EDIT|Code generated|auto-?generated|autogenerated|This file is generated/i;

function isGenerated(text) {
  if (GENERATED.test(text.slice(0, 1500))) return true;
  // Minified or bundled output: very long lines.
  return text.split('\n', 50).some((s) => s.length > 1000);
}

// Rust keeps unit tests in the same file after #[cfg(test)]; lines from there on are tests.
function testCutoff(text, l) {
  if (l !== 'rust') return Infinity;
  const m = /^\s*#\[cfg\(test\)\]/m.exec(text);
  return m ? text.slice(0, m.index).split('\n').length : Infinity;
}

module.exports = { lex, functions, nesting, isGenerated, testCutoff, KEYWORDS };
