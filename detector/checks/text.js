'use strict';
// Text defects current models leave: merge residue, review provenance in code comments,
// em dashes where the house style bans them, lines written twice, doc comments split from
// their item, and PR text whose scope claims contradict the diff.
const { lang, commentOf, SKIP_KINDS, TEXT_KINDS } = require('../files');

const CONFLICT = /^(<{7}(\s|$)|>{7}(\s|$)|\|{7}(\s|$)|={7}$)/;
const PROVENANCE = /\b(revuto|bugbot|coderabbit|copilot review|self-review|code review|review(?:er)? (?:round|comment|feedback|finding|note)s?|round \d+ (?:of )?review|review round \d+|per (?:the )?review|addressed (?:the )?(?:review|feedback)|as (?:requested|suggested) (?:by|in) (?:the )?review|(?:the )?reviewer (?:asked|wanted|flagged|found|noted))\b/i;
const EM_DASH = /—/;
const DOC_LINE = { rust: /^\s*\/\/[/!]/, js: /^\s*(\*\/|\/\*\*|\*\s|\*$)/, py: null, go: /^\s*\/\//, c: /^\s*(\/\/\/|\*\/|\*\s)/, hash: /^\s*#(?!!)/, sh: /^\s*#(?!!)/ };
const ITEM_START = { rust: /^\s*(pub(\([^)]*\))?\s+)?(async\s+|unsafe\s+|const\s+)*(fn|struct|enum|trait|impl|type|mod|const|static)\b|^\s*#\[/, js: /^\s*(export\s+)?(async\s+)?(function|class|const|let|interface|type)\b/, go: /^(func|type|var|const)\b/, c: /^\s*(class|struct|enum|template|static|inline|void|int|bool|auto)\b/, hash: /^\s{0,4}[A-Za-z0-9_-]+:\s*$|^\[[^\]]+\]$/, sh: /^\s*(function\s+)?[A-Za-z_][\w-]*\s*\(\)/ };
const SCOPE_CLAIM = /\b(docs?[- ]only|documentation[- ]only|no code changes?|no behaviou?r(al)? changes?|no functional changes?|tests?[- ]only|comment[- ]only|typo[- ]only|CI[- ]only|config[- ]only)\b/i;

// Bot-written sections of a PR body (review summaries) are not the author's text.
function stripBots(t) {
  let out = t.replace(/<!--\s*CURSOR_SUMMARY\s*-->[\s\S]*?<!--\s*\/CURSOR_SUMMARY\s*-->/g, '');
  // Repeat until stable so a comment split around another one cannot survive.
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(/<!--[\s\S]*?-->/g, ''); }
  return out;
}

// True when every changed line of a code file is a comment, a docstring line or blank.
function commentOnly(ctx, f) {
  const l = lang(f.path);
  if (!l) return false;
  const doc = new Set();
  if (l === 'py') {
    let inDoc = false;
    (ctx.lines(f.path) || []).forEach((ln, i) => {
      const n = (ln.match(/"{3}|'{3}/g) || []).length;
      if (inDoc || n) doc.add(i + 1);
      if (n % 2 === 1) inDoc = !inDoc;
    });
  }
  const quiet = (text) => !text.trim() || (commentOf(text, l) !== null && /^\s*(#|\/\/|\/\*|\*)/.test(text));
  // Removed docstring lines cannot be located in the new file; prose without code punctuation passes.
  const prose = (text) => l === 'py' && !/[=(){}\[\]]/.test(text);
  return f.added.every((a) => quiet(a.text) || doc.has(a.line)) && f.removed.every((r) => quiet(r.text) || prose(r.text));
}

function textLines(f) {
  const l = lang(f.path);
  return f.added.map((a) => {
    if (TEXT_KINDS.has(f.kind)) return { ...a, prose: a.text, isComment: false };
    const c = l ? commentOf(a.text, l) : null;
    return { ...a, prose: c, isComment: c !== null };
  });
}

module.exports = {
  id: 'text',
  scopes: ['diff', 'repo'],
  run(ctx) {
    const items = [];
    const style = ctx.opts.style || {};
    const push = (o) => items.push(o);
    for (const f of ctx.files) {
      if (SKIP_KINDS.has(f.kind)) continue;
      const l = lang(f.path);
      const lines = textLines(f);
      const file = ctx.lines(f.path) || [];
      for (const a of lines) {
        if (CONFLICT.test(a.text) && !(f.kind === 'docs' && /^={7}$/.test(a.text))) {
          push({ check: 'merge-residue', severity: 'high', file: f.path, line: a.line, excerpt: a.text.slice(0, 80), message: 'conflict marker committed' });
        }
        if (a.isComment && PROVENANCE.test(a.prose) && f.kind !== 'test') {
          push({ check: 'review-provenance', severity: 'high', file: f.path, line: a.line, excerpt: a.text.trim().slice(0, 160), message: 'comment records review history; that belongs in the PR or commit, the code comment should say why the code is this way', fix: { fixType: 'review' } });
        }
        if (style.emDash !== false && ctx.scope === 'diff' && a.prose && EM_DASH.test(a.prose) && f.kind !== 'changelog') {
          push({ check: 'em-dash', severity: 'review', file: f.path, line: a.line, excerpt: a.text.trim().slice(0, 160), message: 'em dash; house style uses a comma, colon, parentheses or two sentences' });
        }
        const t = a.text.trim();
        const above = (file[a.line - 2] || '').trim();
        // Code may repeat a statement on purpose (call twice to test idempotence); prose and
        // comments written twice are a slip.
        const proseLike = a.isComment || TEXT_KINDS.has(f.kind) || f.kind === 'config';
        if (proseLike && t.length >= 16 && t === above && !/^[|}\])\-=*#`<]/.test(t)) {
          push({ check: 'duplicate-line', severity: 'high', file: f.path, line: a.line, excerpt: t.slice(0, 160), message: 'same line written twice in a row', fix: { fixType: 'remove-line' } });
        }
      }
      // A new block inserted directly under an unchanged doc comment takes that comment over.
      if (l && DOC_LINE[l] && ITEM_START[l] && !f.whole) {
        if (file.length) {
          for (const b of f.blocks) {
            if (!b.added.length) continue;
            const first = b.added.find((x) => x.text.trim() !== '');
            if (!first || DOC_LINE[l].test(first.text) || !ITEM_START[l].test(first.text)) continue;
            const above = file[b.added[0].line - 2];
            const after = file[b.added[b.added.length - 1].line];
            const addedSet = new Set(f.added.map((x) => x.line));
            if (above === undefined || addedSet.has(b.added[0].line - 1)) continue;
            if (!DOC_LINE[l].test(above) || (l === 'js' && !/\*\/\s*$/.test(above))) continue;
            if (b.removed.length) continue; // a replaced item keeps its own comment
            if (after === undefined || !ITEM_START[l].test(after)) continue;
            push({ check: 'displaced-doc-comment', severity: 'high', file: f.path, line: first.line, excerpt: first.text.trim().slice(0, 160), message: `inserted between a doc comment (line ${b.added[0].line - 1}) and the item it documented; the comment now describes the new item` });
          }
        }
      }
    }
    // Scope claims in the PR body or commit messages that the diff contradicts.
    const prText = stripBots(ctx.prText || '');
    const claimText = [prText, ...(ctx.commits || []).map((c) => c.message)].filter(Boolean).join('\n');
    if (claimText && ctx.scope === 'diff') {
      const byPath = new Map(ctx.files.map((f) => [f.path, f]));
      const codeFiles = ctx.files.filter((f) => f.kind === 'code' && !commentOnly(ctx, f));
      const testFiles = ctx.files.filter((f) => f.kind === 'test');
      // The PR body speaks for the whole branch; a commit message only for its own commit.
      const sources = [{ text: prText, code: codeFiles, tests: testFiles, who: 'the diff' }];
      for (const c of ctx.commits || []) {
        const own = c.files.map((p) => byPath.get(p)).filter(Boolean);
        sources.push({ text: c.message, code: own.filter((f) => codeFiles.includes(f)), tests: own.filter((f) => f.kind === 'test'), who: `commit ${c.sha.slice(0, 7)}` });
      }
      for (const src of sources) {
        for (const line of src.text.split('\n')) {
          // Only a claim about the whole change: a line that opens with it ("Docs-only: ...")
          // or says "this PR is ...", not a mention inside a sentence about something else.
          const m = SCOPE_CLAIM.exec(line);
          if (!m) continue;
          const lead = line.replace(/^[\s>*_#-]*(\*\*)?/, '');
          if (!lead.toLowerCase().startsWith(m[1].toLowerCase()) && !/\b(this|the) (pr|change|patch|commit) is\b/i.test(line)) continue;
          const claim = m[1].toLowerCase();
          const offending = /test/.test(claim) ? src.code : /^(docs?|documentation|comment|typo)/.test(claim) ? [...src.code, ...src.tests] : [];
          if (!offending.length) continue;
          push({ check: 'scope-claim', severity: 'high', file: '(PR text)', line: 0, excerpt: line.trim().slice(0, 160), message: `says "${m[1]}" but ${src.who} changes ${offending.length} code file(s), e.g. ${offending[0].path}` });
        }
      }
      for (const line of claimText.split('\n')) {
        if (style.emDash !== false && EM_DASH.test(line)) {
          push({ check: 'em-dash', severity: 'review', file: '(PR text)', line: 0, excerpt: line.trim().slice(0, 160), message: 'em dash in PR or commit text' });
        }
        if (/^\s*(<{7}|>{7})/.test(line)) push({ check: 'merge-residue', severity: 'high', file: '(PR text)', line: 0, excerpt: line.slice(0, 80), message: 'conflict marker in PR or commit text' });
      }
    }
    return items;
  },
};
