#!/usr/bin/env node
'use strict';
// deslop detector CLI. See --help.
const fs = require('fs');
const path = require('path');
const { detect, formatText } = require('../detector');
const { isRepo, git } = require('../detector/git');

const HELP = `Usage: detect.js [repo] [options] [-- paths...]

Finds what current coding models leave behind in a change: leftover mentions of renamed or
removed things, cited paths that do not exist, new code nothing calls, tests that cannot
fail, review notes in code comments, merge residue, committed secrets and local paths.

Scope
  --scope=diff        (default) the branch's changes against its merge base
  --scope=repo        every tracked file (paths after -- narrow it)
  --scope=PATH        repo scope narrowed to PATH
  --base=REF          base for diff scope (default: origin's default branch)
  --head=REV          revision to scan (default HEAD)
  --worktree          include uncommitted changes (diff scope) / read the work tree

Input
  --pr-body=FILE|-    PR description to check against the diff
  --no-commits        do not read commit messages in the range

Output
  --json              JSON instead of text
  --max=N             findings to print (default: 40 in text, all in JSON; a --max given
                      with --json caps the JSON too, which confirm.js refuses)

Config: .deslop.json at the repo root: {"ignore": [globs], "disable": [check ids], "style": {"emDash": false},
"together": [{"when": glob, "also": glob, "message": text}], "mineCochange": false}.
Exit status: 0 when the scan ran (findings or not), 1 on error.`;

function main(argv) {
  const opts = { scope: 'diff', paths: [] };
  let root = '.';
  let json = false;
  let rest = false;
  let rootSet = false;
  for (const a of argv) {
    if (rest) { opts.paths.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    if (a === '-h' || a === '--help') { console.log(HELP); return 0; }
    if (a === '--json') { json = true; continue; }
    if (a === '--worktree') { opts.worktree = true; continue; }
    if (a === '--no-commits') { opts.commitText = false; continue; }
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (m) {
      const [, k, v] = m;
      // Any other scope value is a path: repo scope narrowed to it.
      if (k === 'scope') { if (['diff', 'repo'].includes(v)) opts.scope = v; else { opts.scope = 'repo'; opts.paths.push(v); } }
      else if (k === 'base') opts.base = v;
      else if (k === 'head') opts.head = v;
      else if (k === 'max') opts.max = Number(v);
      else if (k === 'pr-body') opts.prText = fs.readFileSync(v === '-' ? 0 : v, 'utf8');
      else throw new Error(`unknown option --${k}`);
      continue;
    }
    if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    if (!rootSet) { root = a; rootSet = true; continue; }
    opts.paths.push(a);
  }
  root = path.resolve(root);
  if (!isRepo(root)) throw new Error(`${root} is not a git repository`);
  // Paths in git output are relative to the top level; run from there. A subdirectory given
  // as the repo narrows repo scope to it.
  const top = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
  const sub = path.relative(top, fs.realpathSync(root)).split(path.sep).join('/');
  if (sub && !sub.startsWith('..')) {
    // Paths after -- are relative to the directory given, like the rest of the command line.
    opts.paths = opts.paths.length ? opts.paths.map((p) => path.posix.join(sub, p)) : opts.scope === 'repo' ? [sub] : [];
    root = top;
  }
  if (opts.scope === 'diff' && opts.paths.length) {
    console.error('[WARN] paths are ignored in diff scope; use --scope=repo -- <paths> to scan files');
  }
  const cfgPath = path.join(root, '.deslop.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    opts.ignore = cfg.ignore || [];
    opts.disable = cfg.disable || [];
    opts.style = cfg.style || {};
    opts.together = cfg.together || [];
    if (cfg.mineCochange === false) opts.mineCochange = false;
  }
  // JSON feeds the confirm step, which has to see every finding.
  if (json && opts.max === undefined) opts.max = Infinity;
  const r = detect(root, opts);
  console.log(json ? JSON.stringify(r, null, 2) : formatText(r));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`[ERROR] ${e.message}`);
  process.exitCode = 1;
}
