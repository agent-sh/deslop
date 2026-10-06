'use strict';
// A small lexer for the duplicate-code check. It knows just enough of each language to drop
// comments and keep string contents from looking like code; it is not a parser.

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
// regex literal as one placeholder token, comments and whitespace dropped.
class Lexer {
  constructor(text, l) {
    this.text = text;
    this.l = l;
    this.n = text.length;
    this.i = 0;
    this.line = 1;
    this.toks = [];
    this.heredoc = null;
    this.hashComments = l === 'py' || l === 'sh' || l === 'hash';
  }

  push(v) { this.toks.push({ v, line: this.line }); }

  newline() {
    this.line++;
  }

  run() {
    while (this.i < this.n) {
      const ch = this.text[this.i];
      if (ch === '\n') { this.newline(); this.i++; if (this.heredoc) this.skipHeredoc(); continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { this.i++; continue; }
      if (this.comment(ch) || this.literal(ch) || this.word()) continue;
      this.push(ch);
      this.i++;
    }
    return { toks: this.toks };
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
        this.newline();
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
    for (let k = this.i; k < j; k++) if (this.text[k] === '\n') this.newline();
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
      if (d === '\n') { this.newline(); j++; continue; }
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
      this.i = end < 0 ? this.n : end;
      if ((this.heredoc.strip ? ln.trim() : ln) === this.heredoc.tag) break;
      if (this.i < this.n) { this.newline(); this.i++; }
    }
    this.heredoc = null;
  }
}

const lex = (text, l) => new Lexer(text, l).run();

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

module.exports = { lex, isGenerated, testCutoff, KEYWORDS };
