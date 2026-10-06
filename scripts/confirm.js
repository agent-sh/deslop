#!/usr/bin/env node
'use strict';
// deslop confirm step: a small model reads each detector finding with its context and says
// which are real, and gives mechanical fixes. See --help.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HELP = `Usage: confirm.js [--input=FILE] [--repo=DIR] [--cmd=JSON] [--mode=report|apply] [--dry-run] [--timeout=SECONDS]

Reads detector JSON (detect.js --json) from --input or stdin, asks a small model to confirm each
finding, and prints the DESLOP_RESULT JSON: confirmed findings, dismissed ones with the reason,
and fixes in simple-fixer form. Every fix is checked against the file before it is returned.

The model command is the first of:
  --cmd=JSON             the command as a JSON array of strings, run without a shell; an element
                         that is exactly "{prompt}" becomes the prompt, otherwise the prompt is on
                         stdin. Example: --cmd='["codex", "exec", "-p", "luna", "{prompt}"]'
  DESLOP_SMALL_CMD       the same, from the environment
  the gishra "small" role in $GISHRA_STATE/project.json, or .gishra/project.json at the root of
                         the main checkout; harness claude, codex, opencode, agy, pi or command,
                         with optional model, profile, provider, effort and args

The input must hold every finding the detector made (detect.js --json prints them all). Check
failures the detector recorded are passed on in "detectorErrors".

With no model configured it prints the findings ready to judge and exits 0, so the calling agent
judges them itself. If the model fails, or its reply is not valid or leaves a finding unjudged,
every finding comes back unconfirmed with an "error" field.

  --repo=DIR     repository the findings point into (default: current directory)
  --dry-run      print the model command that would run, as JSON, and exit
  --timeout=S    seconds to wait for the model (default 600)
Exit status: 0 when a result or the judge-it-yourself list was printed, 1 on a usage or input error.`;

const ACTIONS = new Set(['remove-line', 'replace', 'insert-after', 'insert-before']);
// What to read before calling a finding real, per check.
const HINTS = {
  'stale-mention': 'Real if the line describes the current state; a dated record or a "was removed" note is fine.',
  'missing-path': 'Dismiss an example, another repo\'s path, or a file a sibling change adds.',
  'broken-anchor': 'Real unless the target heading exists under another spelling.',
  'scope-claim': 'Comment-only code edits do not break a docs-only claim.',
  'review-provenance': 'Real: the comment should say why the code is this way, not which review asked.',
  'test-cannot-fail': 'Dismiss when a helper the test calls asserts.',
  'test-swallows-failure': 'Dismiss when the failure is checked another way.',
  'no-caller': 'Dismiss entry points, framework hooks and public API used from outside.',
  'unread-setting': 'Dismiss settings read by a tool outside the repo.',
  'dropped-rule': 'Real only if dropping the rule or reason was not intended by the rewrite.',
  'missing-companion': 'Real if the companion file describes or mirrors what changed.',
  'changelog-missing': 'Real if users of the project would notice the change.',
  'doc-example-stale': 'Real unless the line records history or the command still exists under that name.',
  'version-mismatch': 'Real if both files describe the same package or plugin.',
  'duplicate-code': 'Real if the two blocks do the same job and could share one helper; dismiss generated or intentionally mirrored copies.',
  complexity: 'Real if the function would read better split; dismiss a flat table, a dispatcher or generated code.',
  'agent-config': 'Real unless the rule does not apply to this harness or file.',
  'em-dash': 'Real where the house style bans em dashes.',
};

function parseArgs(argv) {
  const o = { mode: 'report', repo: process.cwd(), timeout: 600 };
  for (const a of argv) {
    if (a === '-h' || a === '--help') { o.help = true; continue; }
    if (a === '--dry-run') { o.dryRun = true; continue; }
    const m = /^--([a-z-]+)=(.*)$/s.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    const [, k, v] = m;
    if (k === 'input') o.input = v;
    else if (k === 'repo') o.repo = path.resolve(v);
    else if (k === 'cmd') o.cmd = v;
    else if (k === 'mode') o.mode = v;
    else if (k === 'timeout') o.timeout = Number(v);
    else throw new Error(`unknown option --${k}`);
  }
  if (!['report', 'apply'].includes(o.mode)) throw new Error('--mode is report or apply');
  if (!(o.timeout > 0)) throw new Error('--timeout takes a number of seconds');
  return o;
}

// --- the model command --------------------------------------------------------------------

function gishraRole(repo) {
  let dir = process.env.GISHRA_STATE;
  if (!dir) {
    const r = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    dir = path.join(path.dirname(r.stdout.trim()), '.gishra');
  }
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) return null;
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  const role = project.roles && project.roles.small;
  return role ? { role, file } : null;
}

// argv for a gishra role. The confirm step edits nothing, so no permission flags are passed.
function roleArgv(role, prompt) {
  const extra = Array.isArray(role.args) ? role.args.map(String) : [];
  const opt = (flag, v) => (v ? [flag, String(v)] : []);
  switch (role.harness) {
    case 'codex':
      return ['codex', 'exec', ...(role.profile ? ['-p', role.profile] : opt('-m', role.model)), ...(role.effort ? ['-c', `model_reasoning_effort=${role.effort}`] : []), prompt, ...extra];
    case 'claude':
      return ['claude', '-p', prompt, ...opt('--model', role.model), ...opt('--effort', role.effort), ...extra];
    case 'opencode':
      return ['opencode', 'run', prompt, ...opt('-m', role.model), ...opt('--variant', role.effort), ...extra];
    case 'agy':
      return ['agy', '-p', prompt, ...opt('--model', role.model), ...opt('--effort', role.effort), ...extra];
    case 'pi':
      return ['pi', '-p', prompt, ...opt('--model', role.model), ...opt('--provider', role.provider), ...opt('--thinking', role.effort), ...extra];
    case 'command':
      return [...withPrompt(role.command, prompt, 'the command harness\'s "command"'), ...extra];
    default:
      throw new Error(`unsupported harness "${role.harness}" for the small role`);
  }
}

const PROMPT = '{prompt}';

// A command array with the prompt put in. The prompt is only ever a whole element, so no shell
// or interpreter re-parses repository text; an array without one gets the prompt on stdin.
function withPrompt(command, prompt, where) {
  if (!Array.isArray(command) || !command.length || !command.every((w) => typeof w === 'string')) throw new Error(`${where} takes a non-empty JSON array of strings, such as ["codex", "exec", "{prompt}"]`);
  return command.map((w) => {
    if (w === PROMPT) return prompt;
    if (w.includes(PROMPT)) throw new Error(`${where}: {prompt} must be a whole element, not part of ${JSON.stringify(w.slice(0, 60))}`);
    return w;
  });
}

// How to run the model: {label, argv, stdin, from} or null when nothing is configured.
function resolveModel(o, prompt) {
  const raw = o.cmd || process.env.DESLOP_SMALL_CMD;
  if (raw) {
    const where = o.cmd ? '--cmd' : 'DESLOP_SMALL_CMD';
    let command;
    try { command = JSON.parse(raw); } catch { command = null; }
    const argv = withPrompt(command, prompt, where);
    return { label: command.join(' '), argv, stdin: !command.includes(PROMPT), from: where };
  }
  const g = gishraRole(o.repo);
  if (!g) return null;
  const argv = roleArgv(g.role, prompt);
  const stdin = g.role.harness === 'command' && !g.role.command.includes(PROMPT);
  const label = [g.role.harness, g.role.profile || g.role.model].filter(Boolean).join(':');
  return { label, argv, stdin, from: g.file };
}

// --- the prompt ---------------------------------------------------------------------------

// The absolute path of a repository file, or null when the path leaves the repository or passes
// through a symlink. A tracked link can point anywhere on the machine: its target is neither the
// text the detector scanned nor a file a fix may edit, and sending it to a model discloses it.
function repoFile(repo, file) {
  let root;
  let real;
  try { root = fs.realpathSync(repo); } catch { return null; }
  const want = path.resolve(root, file);
  if (!want.startsWith(root + path.sep)) return null;
  try { real = fs.realpathSync(want); } catch { return null; }
  return real === want ? real : null;
}

function context(repo, file, line, cache) {
  if (!file || file === '(PR text)' || !line) return [];
  if (!cache.has(file)) {
    let lines = null;
    const at = repoFile(repo, file);
    try { if (at) lines = fs.readFileSync(at, 'utf8').split('\n'); } catch { /* unreadable */ }
    cache.set(file, lines);
  }
  const lines = cache.get(file);
  if (!lines) return [];
  const out = [];
  for (let n = Math.max(1, line - 2); n <= Math.min(lines.length, line + 2); n++) {
    out.push(`${n === line ? '>' : ' '} ${String(n).padStart(5)} | ${lines[n - 1].slice(0, 200)}`);
  }
  return out;
}

function describe(item, repo, cache, limit) {
  const out = [`[${item.id}] ${item.check} (${item.severity}) ${item.file}${item.line ? ':' + item.line : ''}`, `    ${item.message}`];
  if (item.changed) {
    const c = item.changed;
    out.push(`    changed in ${c.file}${c.line ? ':' + c.line : ''}: - ${String(c.before || '').trim().slice(0, 160)}${c.after !== undefined ? ` / + ${String(c.after).trim().slice(0, 160)}` : ''}`);
  }
  if (item.fix && item.fix.fixType === 'replace-token') out.push(`    suggested: replace \`${item.fix.from}\` with \`${item.fix.to}\``);
  if (item.fix && item.fix.fixType === 'remove-line') out.push('    suggested: remove the line');
  if (HINTS[item.check]) out.push(`    read: ${HINTS[item.check]}`);
  const ctx = context(repo, item.file, item.line, cache);
  if (ctx.length) out.push(...ctx.map((l) => `    ${l}`));
  else if (item.excerpt) out.push(`    > ${item.excerpt}`);
  return fit(out, limit).join('\n');
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const CLIPPED = ' [clipped]';

// The first n bytes of s, cut at a character boundary.
function clipBytes(s, n) {
  const b = Buffer.from(s, 'utf8');
  if (b.length <= n) return s;
  let end = n;
  while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
  return b.subarray(0, end).toString('utf8');
}

// A finding too large for one prompt (a huge message or excerpt) has its longest line clipped
// until it fits, so it still reaches the model with its header and flagged line.
function fit(lines, limit) {
  const size = () => lines.reduce((n, l) => n + bytes(l) + 1, -1);
  for (let over = size() - limit; over > 0; over = size() - limit) {
    let k = 0;
    for (let i = 1; i < lines.length; i++) if (bytes(lines[i]) > bytes(lines[k])) k = i;
    const keep = bytes(lines[k]) - over - bytes(CLIPPED);
    if (keep <= 0) { lines.splice(k, 1); continue; }
    lines[k] = clipBytes(lines[k], keep) + CLIPPED;
  }
  return lines;
}

const INSTRUCTIONS = `You are confirming findings from deslop, a detector for defects a code change leaves behind (text that was true before the change, references that resolve to nothing, copied code, functions grown too large). For each numbered finding, read the flagged line (marked >) and its context and decide whether it is a real defect after this change.

- Real: put its number in "confirmed".
- Not real (an example, a historical record, another repository's path, an intended choice): put {"id": number, "why": "one short reason"} in "dismissed".
- For a confirmed finding that a mechanical edit of the flagged line fixes, add {"file", "line", "action", "old", "new", "reason"} to "fixes". action is "remove-line", "replace" ("old" is text on that line, "new" replaces it), "insert-after" or "insert-before" ("new" is the whole new line). Leave a fix out when you are not sure of the exact text.
- Judge only these findings. Do not look for other problems and do not edit files.

Reply with one JSON object and nothing else:
{"confirmed": [1], "dismissed": [{"id": 2, "why": "..."}], "fixes": [{"file": "a.md", "line": 3, "action": "replace", "old": "x", "new": "y", "reason": "stale-mention"}]}`;

// Linux refuses to exec an argument over 128 KiB (MAX_ARG_STRLEN, counted in bytes), and the
// prompt is often one; every prompt, instructions included, stays well under that.
const PROMPT_BYTES = 96 * 1024;
const HEAD = `${INSTRUCTIONS}\n\nFindings:\n\n`;

function batches(items, repo) {
  const cache = new Map();
  const room = PROMPT_BYTES - bytes(HEAD) - 1; // the findings, joined by blank lines, then a newline
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    const text = describe(it, repo, cache, room);
    const n = bytes(text);
    if (cur.length && size + 2 + n > room) { out.push(cur); cur = []; size = 0; }
    size += (cur.length ? 2 : 0) + n;
    cur.push({ it, text });
  }
  if (cur.length) out.push(cur);
  return out.map((b) => ({ ids: b.map((x) => x.it.id), prompt: `${HEAD}${b.map((x) => x.text).join('\n\n')}\n` }));
}

// --- the reply ----------------------------------------------------------------------------

// The JSON object in a model reply: the whole reply, a fenced block, or the last balanced object.
function extractJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch { /* look further */ }
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let m;
  let last = null;
  while ((m = fence.exec(t))) last = m[1];
  if (last) { try { return JSON.parse(last); } catch { /* look further */ } }
  for (let end = t.lastIndexOf('}'); end > 0; end = t.lastIndexOf('}', end - 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = end; i >= 0; i--) {
      const c = t[i];
      if (c === '"' && t[i - 1] !== '\\') inStr = !inStr;
      if (inStr) continue;
      if (c === '}') depth++;
      if (c === '{' && --depth === 0) {
        try { return JSON.parse(t.slice(i, end + 1)); } catch { break; }
      }
    }
  }
  throw new Error('no JSON object in the model reply');
}

const isId = (v) => (Number.isInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d*$/.test(v));

// Strict shape check; throws on anything that is not the contract.
function validate(reply, ids) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('reply is not a JSON object');
  for (const k of ['confirmed', 'dismissed', 'fixes']) if (!Array.isArray(reply[k])) throw new Error(`"${k}" is not an array`);
  const known = new Set(ids);
  const seen = new Set();
  const take = (v, where) => {
    if (!isId(v)) throw new Error(`${where}: ${JSON.stringify(v)} is not a finding number`);
    const n = Number(v);
    if (!known.has(n)) throw new Error(`${where}: there is no finding ${n}`);
    if (seen.has(n)) throw new Error(`finding ${n} is judged twice`);
    seen.add(n);
    return n;
  };
  const confirmed = reply.confirmed.map((v) => take(v, 'confirmed'));
  const dismissed = reply.dismissed.map((d) => {
    if (!d || typeof d !== 'object' || typeof d.why !== 'string') throw new Error('dismissed entries are {"id", "why"}');
    return { id: take(d.id, 'dismissed'), why: d.why };
  });
  for (const f of reply.fixes) {
    if (!f || typeof f !== 'object' || typeof f.file !== 'string' || !Number.isInteger(f.line) || f.line < 1 || !ACTIONS.has(f.action)) {
      throw new Error(`fix ${JSON.stringify(f).slice(0, 120)} needs file, a positive integer line and an action of ${[...ACTIONS].join(', ')}`);
    }
    if (f.action === 'replace' && (typeof f.old !== 'string' || !f.old || typeof f.new !== 'string')) throw new Error('a replace fix needs "old" and "new" strings');
    if (f.action.startsWith('insert') && typeof f.new !== 'string') throw new Error('an insert fix needs a "new" string');
  }
  // A finding the reply skips is not judged, and reporting the rest would read as clean.
  const missing = ids.filter((n) => !seen.has(n));
  if (missing.length) throw new Error(`the reply does not judge finding${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
  return { confirmed, dismissed, fixes: reply.fixes };
}

// A fix is kept only when it edits a confirmed finding's line and its old text is on that line.
function checkFixes(fixes, confirmedItems, repo) {
  const kept = [];
  const rejected = [];
  const lines = new Map();
  for (const f of fixes) {
    if (!confirmedItems.some((it) => it.file === f.file && it.line === f.line)) { rejected.push({ fix: f, why: 'not the line of a confirmed finding' }); continue; }
    if (!repoFile(repo, f.file)) { rejected.push({ fix: f, why: 'not a file inside the repository (outside it or through a symlink)' }); continue; }
    if (!lines.has(f.file)) {
      let l = null;
      try { l = fs.readFileSync(repoFile(repo, f.file), 'utf8').split('\n'); } catch { /* unreadable */ }
      lines.set(f.file, l);
    }
    const text = (lines.get(f.file) || [])[f.line - 1];
    if (text === undefined) { rejected.push({ fix: f, why: 'line does not exist' }); continue; }
    if ((f.action === 'replace' || (f.action === 'remove-line' && typeof f.old === 'string' && f.old)) && !text.includes(f.old)) { rejected.push({ fix: f, why: '"old" is not on that line' }); continue; }
    const fix = { file: f.file, line: f.line, action: f.action };
    if (typeof f.old === 'string') fix.old = f.old;
    if (typeof f.new === 'string') fix.new = f.new;
    fix.reason = typeof f.reason === 'string' && f.reason ? f.reason : confirmedItems.find((it) => it.file === f.file && it.line === f.line).check;
    kept.push(fix);
  }
  return { kept, rejected };
}

function runModel(model, prompt, o) {
  const [bin, ...args] = model.argv;
  const r = spawnSync(bin, args, {
    cwd: o.repo,
    input: model.stdin ? prompt : '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: o.timeout * 1000,
  });
  if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? `model timed out after ${o.timeout}s` : `could not run the model: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`model exited ${r.status}: ${(r.stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
  return r.stdout;
}

const brief = (it) => ({ id: it.id, file: it.file, line: it.line, check: it.check, severity: it.severity, message: it.message });

function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(HELP); return 0; }
  const raw = o.input ? fs.readFileSync(o.input, 'utf8') : fs.readFileSync(0, 'utf8');
  const report = JSON.parse(raw);
  if (!report || !Array.isArray(report.items)) throw new Error('input is not detector JSON (no "items" array); run detect.js --json');
  // Findings left out of the input (detect.js --max) would never be judged, and a result
  // without them could read as clean.
  if (report.total > report.items.length) throw new Error(`the input holds ${report.items.length} of the detector's ${report.total} findings; run detect.js --json without --max so every finding is judged`);
  const items = report.items.map((it, i) => ({ ...it, id: i + 1 }));
  const result = { mode: o.mode, scope: report.scope || 'diff', base: report.base, findings: [], fixes: [], dismissed: [], unconfirmed: [], summary: { reported: items.length, confirmed: 0, dismissed: 0, fixable: 0 } };
  // A check that failed found nothing, which is not the same as finding nothing.
  if (Array.isArray(report.errors) && report.errors.length) result.detectorErrors = report.errors.map(String);
  // Languages a check could not measure, so the summary does not imply they were covered.
  if (Array.isArray(report.skipped) && report.skipped.length) result.skipped = report.skipped.map(String);
  const coverage = {
    ...(result.detectorErrors ? { detectorErrors: result.detectorErrors } : {}),
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
  if (!items.length) { console.log(JSON.stringify(result, null, 2)); return 0; }
  const parts = batches(items, o.repo);
  const model = resolveModel(o, parts[0].prompt);
  if (o.dryRun) {
    console.log(JSON.stringify({ ...(model ? { model: model.label, from: model.from, argv: model.argv, stdin: model.stdin, batches: parts.length } : { model: null }), ...coverage }, null, 2));
    return 0;
  }
  if (!model) {
    console.log(`deslop-confirm: no small model configured (--cmd, DESLOP_SMALL_CMD or a gishra "small" role). Judge these ${items.length} findings yourself and build the DESLOP_RESULT block.\n`);
    if (result.detectorErrors) console.log(`The detector also failed in part; put these in "detectorErrors":\n${result.detectorErrors.map((e) => `- ${e}`).join('\n')}\n`);
    if (result.skipped) console.log(`The detector did not cover these checks; put these in "skipped":\n${result.skipped.map((s) => `- ${s}`).join('\n')}\n`);
    console.log(parts.map((p) => p.prompt).join('\n'));
    return 0;
  }
  result.model = model.label;
  const byId = new Map(items.map((it) => [it.id, it]));
  try {
    const confirmed = [];
    const fixes = [];
    for (const part of parts) {
      const m = resolveModel(o, part.prompt);
      const v = validate(extractJson(runModel(m, part.prompt, o)), part.ids);
      confirmed.push(...v.confirmed);
      for (const d of v.dismissed) result.dismissed.push({ ...brief(byId.get(d.id)), why: d.why });
      fixes.push(...v.fixes);
    }
    result.findings = confirmed.map((n) => brief(byId.get(n)));
    const { kept, rejected } = checkFixes(fixes, result.findings, o.repo);
    result.fixes = kept;
    if (rejected.length) result.rejectedFixes = rejected;
  } catch (e) {
    // Nothing from a bad reply is trusted: every finding goes back unjudged.
    result.findings = [];
    result.fixes = [];
    result.dismissed = [];
    result.unconfirmed = items.map(brief);
    result.error = e.message;
  }
  result.summary = { ...result.summary, confirmed: result.findings.length, dismissed: result.dismissed.length, fixable: result.fixes.length };
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`[ERROR] ${e.message}`);
  process.exitCode = 1;
}
