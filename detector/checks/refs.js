'use strict';
// Paths the change cites that do not exist, and machine-local paths committed to the repo.
const { lang, commentOf, SKIP_KINDS, TEXT_KINDS } = require('../files');

const MD_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CANDIDATE = /(?<![\w@:/.$~-])(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9_.@-]*(?:\/[A-Za-z0-9_.@{},-]+)+\/?/g;
// A developer's own checkout or home, not a service account's home (/home/runner is fine).
const HOME = new RegExp([
  String.raw`(?<![\w.-])/Users/(?!(?:Shared|user|username|me|you|name|yourname|someone|foo|example)/)[A-Za-z0-9._-]+/`,
  String.raw`(?<![\w.-])/home/(?!(?:user|username|me|you|name|yourname|someone|foo|example|runner|ubuntu|root)/)[a-z_][a-z0-9_-]*/(?:projects|src|code|repos|git|workspace|work|dev|Desktop|Documents|Downloads|wt-[\w-]+)/`,
  String.raw`[A-Z]:\\Users\\[A-Za-z0-9._-]+\\`,
].join('|'), 'g');
const OWN_HOME = require('os').homedir();
const PLACEHOLDER = /(^|\/)(path\/to|your[-_]|example|foo|bar|my[-_]?(app|project|repo)|xxx|<|\.\.\.)/i;

function expandBraces(p) {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(',').flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

// Text that may cite repo paths: prose files, config, and comments in code.
function citingText(f, text) {
  if (TEXT_KINDS.has(f.kind) || f.kind === 'config' || f.kind === 'ci') return text;
  const l = lang(f.path);
  return l ? commentOf(text, l) : null;
}

module.exports = {
  id: 'refs',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    const topLevel = new Set([...ctx.headFiles].map((f) => f.split('/')[0]));
    const check = (f, line, raw, cited, how, next) => {
      // A glob or template (stt-testclient*, test_ci_*.py, ADS-{x}) is not one path.
      if (next && /[*?[{<$%]/.test(next)) return;
      // Paths relative to another root (an installed plugin, $HOME) are not this repo's.
      if (/\$HOME|\$\{?[A-Z_]+\}?\/|~\/|plugin root|@module/.test(raw)) return;
      // A line that says the file is gone (deleted, removed, a dated record) is citing history.
      if (/\b(deleted|removed|retired|renamed|superseded|formerly|previously|no longer)\b/i.test(raw)) return;
      let p = cited.replace(/[.,;:)'"`]+$/, '').replace(/:\d+(-\d+)?$/, '').replace(/#.*$/, '');
      if (!p || p.length < 4 || /[*$<>~()]|\.\.\.|^[a-z]+:/i.test(p) || PLACEHOLDER.test(p)) return;
      // A bare word is not a path; a citation has a directory or a file extension.
      if (!p.includes('/') && !/\.[A-Za-z0-9]{1,5}$/.test(p)) return;
      if (/^(https?|mailto|ftp):/.test(cited) || p.startsWith('//')) return;
      for (const alt of expandBraces(p)) {
        const rel = alt.startsWith('./') || alt.startsWith('../');
        const fromFile = ctx.rel(f.path, alt);
        const fromRoot = alt.replace(/^\.\//, '').replace(/\/$/, '');
        if (ctx.exists(fromFile) || ctx.exists(fromRoot)) continue;
        // Only judge paths that are anchored in this repo: relative to the citing file, or
        // starting with a top-level directory that exists. Anything else may be another repo's path.
        const first = fromRoot.split('/')[0];
        const anchored = rel || how === 'link' || (topLevel.has(first) && ctx.dirs.has(first));
        if (!anchored) continue;
        // Deleted by this change is near-certain drift; never existed may be another repo's path.
        const wasThere = ctx.baseFiles && (ctx.baseFiles.has(fromRoot) || ctx.baseFiles.has(fromFile));
        items.push({
          check: 'missing-path',
          severity: wasThere ? 'high' : 'review',
          file: f.path,
          line,
          excerpt: raw.trim().slice(0, 160),
          message: wasThere
            ? `cites \`${alt}\`, which this change deleted or moved`
            : `cites \`${alt}\`, which does not exist in this repo`,
          token: alt,
        });
      }
    };
    let localPaths = 0;
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      let localInFile = false;
      for (const a of f.added) {
        const homes = [...a.text.matchAll(HOME)].map((m) => m[0]);
        if (OWN_HOME.length > 6 && a.text.includes(OWN_HOME + '/') && !homes.length) homes.push(OWN_HOME + '/');
        for (const h of homes.slice(0, 1)) {
          // One per file and a few per run: the first ones say what to fix.
          if (f.kind === 'changelog' || localInFile || localPaths >= 5) continue;
          localInFile = true;
          localPaths++;
          const m = [h];
          items.push({
            check: 'local-path',
            severity: 'high',
            file: f.path,
            line: a.line,
            excerpt: a.text.trim().slice(0, 160),
            message: `machine-local path \`${m[0]}\` committed; it breaks on any other checkout and can leak a username`,
          });
        }
        const text = citingText(f, a.text);
        if (!text) continue;
        const seen = new Set();
        for (const m of text.matchAll(MD_LINK)) { seen.add(m[1]); check(f, a.line, a.text, m[1], 'link', ''); }
        for (const m of text.matchAll(CANDIDATE)) {
          if ([...seen].some((s) => s.includes(m[0]))) continue;
          // URLs and domain names are not repo paths.
          const pre = text.slice(Math.max(0, m.index - 8), m.index);
          if (/:\/\/[\w.-]*$|www\.$/.test(pre) || /^[\w-]+\.(com|org|io|ai|dev|net|sh)\//.test(m[0])) continue;
          check(f, a.line, a.text, m[0], 'path', text[m.index + m[0].length] || '');
        }
      }
    }
    // Many never-existing paths in one file are usually examples; keep the first few.
    const perFile = new Map();
    return items.filter((it) => {
      if (it.check !== 'missing-path' || it.severity === 'high') return true;
      const n = (perFile.get(it.file) || 0) + 1;
      perFile.set(it.file, n);
      return n <= 3;
    });
  },
};
