'use strict';
// File classification and token extraction shared by the checks.
const path = require('path');

const LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|composer\.lock|Gemfile\.lock|bun\.lockb?)$|\.lock$/;
const VENDOR = /(^|\/)(node_modules|vendor|third_party|dist|build|target|\.git|__snapshots__)\/|\.min\.(js|css)$|\.map$|(^|\/)generated\//;
const TEST = /(^|\/)(tests?|__tests__|spec|fixtures?|testdata)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go|rs)$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)conftest\.py$/;
const DOC = /\.(md|mdx|markdown|rst|txt|adoc)$/i;
const PROMPT = /(^|\/)(SKILL|AGENTS|CLAUDE|GEMINI)\.md$|(^|\/)(agents|commands|skills|prompts)\/[^/]+(\/[^/]+)*\.md$/;
const CI = /^\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)\.circleci\//;
const CONFIG = /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|properties)$|(^|\/)[^/]*\.env(\.[^/]+)?$|\.template$|(^|\/)(Dockerfile|Makefile|\.gitignore|\.gitattributes)$/;
// Recorded output (logs, receipts, results files) is evidence, not something to keep in sync.
const DATA = /\.(log|jsonl|ndjson|csv|tsv|out|err|sarif|har|pcap|ipynb)$|(^|\/)(receipts?|logs?|evidence|raw|captures?)\/|(^|\/)[A-Z0-9_-]+\.json$|(^|\/)[^/]*(results?|receipts?|reports?|outputs?|metrics|bench(mark)?s?|traces?|mutants?|raw)[^/]*\.json$/i;
const CHANGELOG = /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASE[-_]NOTES)[^/]*$/i;
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp', '.cu', '.cuh', '.rb', '.php', '.swift', '.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.lua', '.zig', '.ex', '.exs', '.astro', '.vue', '.svelte', '.sql', '.cs', '.scala', '.adb', '.ads']);

function kind(p) {
  if (LOCK.test(p)) return 'lock';
  if (VENDOR.test(p)) return 'vendor';
  if (CHANGELOG.test(p)) return 'changelog';
  if (DATA.test(p)) return 'data';
  if (CI.test(p)) return 'ci';
  if (PROMPT.test(p)) return 'prompt';
  if (TEST.test(p)) return 'test';
  if (DOC.test(p)) return 'docs';
  if (CONFIG.test(p)) return 'config';
  if (CODE_EXT.has(path.extname(p).toLowerCase())) return 'code';
  return 'other';
}

const TEXT_KINDS = new Set(['docs', 'prompt', 'changelog']);
const SKIP_KINDS = new Set(['lock', 'vendor', 'data']);

function lang(p) {
  const ext = path.extname(p).toLowerCase();
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.astro', '.vue', '.svelte'].includes(ext)) return 'js';
  if (ext === '.py') return 'py';
  if (ext === '.rs') return 'rust';
  if (ext === '.go') return 'go';
  if (['.sh', '.bash', '.zsh'].includes(ext)) return 'sh';
  if (['.c', '.h', '.cc', '.cpp', '.hpp', '.cu', '.cuh', '.java', '.kt', '.cs', '.swift', '.scala', '.zig'].includes(ext)) return 'c';
  if (['.yml', '.yaml', '.toml'].includes(ext) || /(^|\/)(Makefile|Dockerfile)$/.test(p) || /\.env/.test(p)) return 'hash';
  return null;
}

// Comment text of a code line, or null when the line carries no comment.
function commentOf(text, l) {
  const t = text.trim();
  if (l === 'py' || l === 'sh' || l === 'hash') {
    if (t.startsWith('#!')) return null;
    if (t.startsWith('#')) return t.slice(1);
    const m = /\s#\s(.*)$/.exec(text);
    return m && !/["'`]/.test(text.slice(0, m.index).replace(/(["'`]).*?\1/g, '')) ? m[1] : null;
  }
  if (l === 'js' || l === 'rust' || l === 'go' || l === 'c') {
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return t.replace(/^(\/\/+!?|\/\*+|\*+\/?)/, '');
    const m = /\s\/\/\s(.*)$/.exec(text);
    if (m && !/https?:$/.test(text.slice(0, m.index))) {
      const before = text.slice(0, m.index).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '');
      if (!/["'`]/.test(before)) return m[1];
    }
    return null;
  }
  return null;
}

// Tokens specific enough that a leftover mention elsewhere is meaningful: identifiers with
// underscores or inner capitals, CLI flags, paths, versions, dashed names in code quotes,
// and numbers with at least three significant digits.
const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/g;
const FLAG = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)+|(?<![\w-])--[a-z][a-z0-9]{3,}/g;
const PATHLIKE = /(?<![\w@:/.-])(?:\.{1,2}\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.{},-]+)+\/?/g;
const VERSION = /(?<![\w.])v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?![\w.])/g;
const QUOTED_DASHED = /[`'"]([a-z][a-z0-9]*(?:[-.][a-z0-9]+)+)[`'"]/g;
const NUMBER = /(?<![\w.,#])\d{1,3}(?:,\d{3})+(?![\d,])|(?<![\w.,#])\d{3,}(?:\.\d+)?(?![\w.])|(?<![\w.,#])\d+\.\d{2,}(?![\w.])/g;

const STOP = new Set(['__init__', '__name__', '__main__', '__dirname', '__filename', 'module_exports', 'node_modules', 'TODO_', 'README']);

function isSpecificIdent(t) {
  if (t.length < 5 || STOP.has(t)) return false;
  if (/^_+$/.test(t)) return false;
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t)) return true; // ENV_VAR
  if (/[a-z0-9]_[a-zA-Z0-9]/.test(t)) return true; // snake_case
  if (/[a-z][A-Z]/.test(t) && t.length >= 6) return true; // camelCase
  if (t.includes('::')) return true;
  return false;
}

function tokens(text, { numbers = true } = {}) {
  const out = new Set();
  for (const m of text.matchAll(IDENT)) if (isSpecificIdent(m[0])) out.add(m[0]);
  for (const m of text.matchAll(FLAG)) out.add(m[0]);
  for (const m of text.matchAll(PATHLIKE)) {
    const p = m[0].replace(/[.,]+$/, '');
    if (p.length >= 6 && /[A-Za-z]/.test(p) && !/^\d/.test(p) && !p.includes('//')) out.add(p);
  }
  for (const m of text.matchAll(VERSION)) out.add(m[0]);
  for (const m of text.matchAll(QUOTED_DASHED)) if (m[1].length >= 6) out.add(m[1]);
  if (numbers) for (const m of text.matchAll(NUMBER)) out.add(m[0]);
  return out;
}

function tokenType(t) {
  if (t.startsWith('--')) return 'flag';
  if (/^v?\d+\.\d+\.\d+/.test(t)) return 'version';
  if (/^[\d,.]+$/.test(t)) return 'number';
  if (t.includes('/')) return 'path';
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t)) return 'env';
  if (/^[a-z0-9.-]+$/.test(t) && /[-.]/.test(t)) return 'name';
  return 'ident';
}

module.exports = { kind, lang, commentOf, tokens, tokenType, TEXT_KINDS, SKIP_KINDS };
