'use strict';
// Docs that no longer match the code, beyond one stale mention (drift.js covers those):
// - changelog-missing: a user-visible change (a CLI flag, an env var the code reads, a command,
//   skill or agent file, a package bin, or a feat/fix/perf commit over code) in a repo that keeps
//   an Unreleased section, with no changelog entry.
// - doc-example-stale: a docs example runs this repo's own CLI or slash command with a flag
//   nothing defines, or a slash command whose file this change deleted.
// - version-mismatch: the change moved a package's version in one manifest and left another
//   manifest of the same package at the old version, or a new docs line pins another version.
// Snapshot and dated record folders (versioned_docs/, archive/) keep old flags and versions on
// purpose, so they are neither read as docs nor counted as manifests.
const path = require('path');
const { lang, SKIP_KINDS, TEXT_KINDS, ENV_READ, OPTION_DEF, FLAG_NAME, SNAPSHOT } = require('../files');

const CHANGELOG_NAMES = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md', 'changelog.md'];
const UNRELEASED = /^#{2,3}\s*\[?unreleased\]?/im;
// Conventional-commit types that announce a user-visible change, as sync-docs reads them.
const USER_VISIBLE_COMMIT = /^(feat|fix|perf)(\([^)]*\))?!?:|^[a-z]+(\([^)]*\))?!:|BREAKING CHANGE/;
// Plugin surfaces a user invokes by name.
const SURFACE = /(^|\/)(commands|agents)\/[^/]+\.md$|(^|\/)skills\/[^/]+\/SKILL\.md$/;
// A line that records history may name old flags and versions.
const HISTORY = /\b(removed|deleted|retired|renamed|replaced|superseded|formerly|previously|no longer|used to|deprecated|since)\b|\b20\d\d-[01]\d-[0-3]\d\b/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- changelog-missing -------------------------------------------------------------------

function flagsOn(lines) {
  const out = new Map();
  for (const a of lines) {
    if (!OPTION_DEF.test(a.text)) continue;
    for (const m of a.text.matchAll(FLAG_NAME)) if (!out.has(m[0])) out.set(m[0], a.line);
  }
  return out;
}

// Variables the platform or CI sets; reading one is not a setting users configure.
const SYSTEM_ENV = /^(XDG|GITHUB|RUNNER|ACTIONS|CARGO|RUST|NPM|npm|LC|DBUS|WAYLAND|SSH|GPG|JAVA|PYTHON|VIRTUAL|CONDA|NODE|BUN|DENO|GO|HOMEBREW|TERM|WSL|MSYS|CUDA|NVIDIA)_|^(PATH_INFO|USER_PROFILE|HOME_DIR)$/;

function envsOn(lines) {
  const out = new Map();
  for (const a of lines) {
    for (const m of a.text.matchAll(ENV_READ)) {
      const n = m.slice(1).find(Boolean);
      if (n && n.includes('_') && !SYSTEM_ENV.test(n) && !out.has(n)) out.set(n, a.line);
    }
  }
  return out;
}

// A package.json's commands and the file each runs. A string "bin" is named after the package
// without its scope, as npm installs it.
function binEntries(text) {
  try {
    const pkg = JSON.parse(text);
    if (typeof pkg.bin === 'string') return new Map([[String(pkg.name || '').replace(/^@[^/]+\//, ''), pkg.bin]]);
    return new Map(Object.entries(pkg.bin || {}).map(([k, v]) => [k, typeof v === 'string' ? v : null]));
  } catch { return new Map(); }
}
const binsOf = (text) => new Set(binEntries(text).keys());

function userVisibleChanges(ctx) {
  const out = [];
  // Across all files, so a flag or env read that moved between files is neither added nor removed.
  const tally = { addedFlags: new Map(), removedFlags: new Map(), addedEnv: new Map(), removedEnv: new Map() };
  const merge = (into, from, file) => { for (const [k, line] of from) if (!into.has(k)) into.set(k, { file, line }); };
  for (const f of ctx.files) {
    if (f.kind !== 'code' || !lang(f.path) || SNAPSHOT.test(f.path)) continue;
    merge(tally.addedFlags, flagsOn(f.added), f.path);
    merge(tally.removedFlags, flagsOn(f.removed), f.oldPath);
    merge(tally.addedEnv, envsOn(f.added), f.path);
    merge(tally.removedEnv, envsOn(f.removed), f.oldPath);
  }
  for (const [k, at] of tally.addedFlags) if (!tally.removedFlags.has(k)) out.push({ file: at.file, line: at.line, what: `adds \`${k}\`` });
  for (const [k, at] of tally.removedFlags) if (!tally.addedFlags.has(k)) out.push({ file: at.file, line: 0, what: `removes \`${k}\`` });
  for (const [k, at] of tally.addedEnv) if (!tally.removedEnv.has(k)) out.push({ file: at.file, line: at.line, what: `reads \`${k}\`` });
  for (const [k, at] of tally.removedEnv) if (!tally.addedEnv.has(k)) out.push({ file: at.file, line: 0, what: `stops reading \`${k}\`` });
  for (const f of ctx.files) {
    if (SNAPSHOT.test(f.path) || (f.oldPath && SNAPSHOT.test(f.oldPath))) continue;
    if (SURFACE.test(f.path) && f.status === 'A') out.push({ file: f.path, line: 1, what: `adds ${f.path}` });
    if (f.oldPath && SURFACE.test(f.oldPath) && f.status === 'D') out.push({ file: f.oldPath, line: 0, what: `removes ${f.oldPath}` });
    if (path.posix.basename(f.path) === 'package.json' && f.status === 'M' && ctx.baseReader) {
      const before = binsOf(ctx.baseReader.read(f.oldPath) || '');
      const after = binsOf(ctx.headReader.read(f.path) || '');
      for (const b of after) if (!before.has(b)) out.push({ file: f.path, line: 0, what: `adds the \`${b}\` command` });
      for (const b of before) if (!after.has(b)) out.push({ file: f.path, line: 0, what: `removes the \`${b}\` command` });
    }
  }
  return out;
}

function nearestChangelog(ctx, file) {
  const parts = file.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/');
    for (const n of CHANGELOG_NAMES) {
      const p = dir ? `${dir}/${n}` : n;
      if (ctx.headFiles.has(p)) return p;
    }
  }
  return null;
}

function changelogMissing(ctx) {
  const items = [];
  if (ctx.scope !== 'diff') return items;
  // Changesets and news fragments write the changelog at release time; an entry is a new file there.
  const fragments = /(^|\/)(\.changeset|changelog\.d|newsfragments|changes)\//;
  if (ctx.files.some((f) => fragments.test(f.path))) return items;
  if ([...ctx.headFiles].some((p) => p.startsWith('.changeset/'))) return items;
  const byLog = new Map();
  const add = (log, s) => {
    if (!byLog.has(log)) byLog.set(log, []);
    byLog.get(log).push(s);
  };
  for (const s of userVisibleChanges(ctx)) {
    if (ctx.kindOf(s.file) === 'test') continue;
    const log = nearestChangelog(ctx, s.file);
    if (log) add(log, s);
  }
  // A feat, fix or perf commit announces a user-visible change by its own type.
  const announced = (ctx.commits || []).map((c) => c.message.split('\n')[0]).filter((sub) => USER_VISIBLE_COMMIT.test(sub));
  if (announced.length) {
    for (const f of ctx.files) {
      if (f.kind !== 'code' || !(f.added.length || f.removed.length) || SNAPSHOT.test(f.path)) continue;
      const log = nearestChangelog(ctx, f.path);
      if (log && !byLog.has(log)) add(log, { file: f.path, line: 0, what: `commits "${announced[0].slice(0, 60)}"`, commit: true });
    }
  }
  for (const [log, changes] of byLog) {
    if (ctx.touched.has(log)) continue;
    const lines = ctx.lines(log) || [];
    const at = lines.findIndex((l) => UNRELEASED.test(l));
    if (at < 0) continue; // written at release time from commits, not kept by hand
    const shown = changes.slice(0, 3).map((c) => (c.commit ? c.what : `${c.what} (${c.file}${c.line ? ':' + c.line : ''})`)).join(', ');
    const message = `this change ${shown}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}, but ${log} has no entry under Unreleased`;
    items.push({
      check: 'changelog-missing',
      severity: 'review',
      file: log,
      line: at + 1,
      excerpt: lines[at].trim(),
      message,
      token: changes.map((c) => c.what).join(','),
    });
  }
  return items;
}

// --- doc-example-stale -------------------------------------------------------------------

// Commands this repo ships, each with the file it runs when the manifest says (null when not):
// package bins, Cargo binaries, Python console scripts, Go cmd/ directories, and plugin slash
// commands.
function ownCommands(ctx) {
  const bins = new Map();
  const add = (b, entry) => { if (b && b.length >= 3 && !bins.get(b)) bins.set(b, entry && ctx.headFiles.has(entry) ? entry : null); };
  const manifests = [...ctx.headFiles].filter((p) => /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml)$/.test(p) && !SKIP_KINDS.has(ctx.kindOf(p)) && !SNAPSHOT.test(p));
  const texts = ctx.headReader.readMany ? ctx.headReader.readMany(manifests) : manifests.map((p) => ctx.headReader.read(p));
  manifests.forEach((p, i) => {
    const text = texts[i];
    if (!text) return;
    const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p) + '/';
    if (p.endsWith('package.json')) { for (const [b, file] of binEntries(text)) add(b, file && path.posix.normalize(dir + file)); return; }
    if (p.endsWith('Cargo.toml')) {
      for (const m of text.matchAll(/\[\[bin\]\]([^[]*)/g)) {
        const name = /\bname\s*=\s*"([^"]+)"/.exec(m[1]);
        const file = /\bpath\s*=\s*"([^"]+)"/.exec(m[1]);
        if (name) add(name[1], file ? path.posix.normalize(dir + file[1]) : `${dir}src/bin/${name[1]}.rs`);
      }
      const pkg = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(text);
      if (pkg && ctx.headFiles.has(`${dir}src/main.rs`)) add(pkg[1], `${dir}src/main.rs`);
      return;
    }
    const scripts = /\[(?:project\.scripts|tool\.poetry\.scripts)\]([^[]*)/g;
    for (const m of text.matchAll(scripts)) {
      for (const k of m[1].matchAll(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=\s*(?:["']([\w.]+)(?::[\w.]+)?["'])?/gm)) {
        const mod = (k[2] || '').replace(/\./g, '/');
        add(k[1], mod && [`${mod}.py`, `src/${mod}.py`, `${mod}/__init__.py`, `src/${mod}/__init__.py`].map((f) => dir + f).find((f) => ctx.headFiles.has(f)));
      }
    }
  });
  for (const p of ctx.headFiles) {
    const m = /(^|\/)cmd\/([^/]+)\/main\.go$/.exec(p);
    if (m && !SNAPSHOT.test(p)) add(m[2], p);
  }
  const slash = new Set();
  for (const p of ctx.headFiles) {
    const m = /(^|\/)commands\/([a-z0-9][\w-]*)\.md$/.exec(p);
    if (m && !SNAPSHOT.test(p)) slash.add(m[2]);
  }
  return { bins, slash };
}

// Flags every common parser library (argparse, click, commander, yargs, clap, cobra, Go's flag)
// answers without the program spelling them.
const BUILTIN_FLAGS = new Set(['--help', '--version']);
// Parser settings that keep unknown flags for another program instead of rejecting them.
const PASS_THROUGH = /\b(parse_known_args|REMAINDER|ignore_unknown_options|allow_extra_args|allowUnknownOption|passThroughOptions|unknown-options-as-args|halt-at-non-option|trailing_var_arg|allow_hyphen_values|allow_external_subcommands|DisableFlagParsing|UnknownFlags)\b/;
const RAW_ARGS = /process\.argv\.slice\(|sys\.argv\[1:\]|os\.Args\[1:\]|env::args(_os)?\(\)\.skip\(/;
const SPAWNS = /\b(spawn|spawnSync|execFile|execFileSync|execSync|fork|execa|execaSync|subprocess|Popen|os\.exec\w*|execv\w*|exec\.Command|syscall\.Exec|Command::new)\b/;
const SH_ARGS = /"\$@"|"\$\{@\}"|\$@|\$\*|"\$\{\w+\[@\]\}"/;

// Whether a command's entry file hands its arguments to another program, so a flag it does not
// spell may still be one that program takes. When unsure it says yes: the cost is a REVIEW
// finding where a HIGH one would have been right, the other way round it is a false HIGH.
function passesArgsOn(text, file) {
  if (PASS_THROUGH.test(text)) return true;
  if (lang(file) !== 'sh') return RAW_ARGS.test(text) && SPAWNS.test(text);
  // A shell line that runs a command with "$@", other than a loop, case or set over the
  // arguments or a call of the script's own function.
  const own = new Set([...text.matchAll(/^\s*(?:function\s+([\w-]+)|([\w-]+)\s*\(\))/gm)].map((m) => m[1] || m[2]));
  return text.split('\n').some((line) => {
    if (!SH_ARGS.test(line)) return false;
    const words = line.trim().split(/\s+/);
    while (words.length > 1 && /^\w+=/.test(words[0])) words.shift();
    if (words.length === 1 && /^\w+=/.test(words[0])) return false; // args=("$@")
    return !/^(for|case|set|shift|#)/.test(words[0]) && !own.has(words[0]);
  });
}

// Parts of a doc line that are code: the whole line inside a fence, else its `code spans`.
function codeParts(text, inFence) {
  if (inFence) return [text];
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function fenceLines(lines) {
  const inside = new Set();
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) inside.add(i + 1);
  });
  return inside;
}

// Flags given to one of our commands in a piece of code: [{cmd, kind, flag, entry}].
function invocations(code, own, scripts) {
  const out = [];
  for (const seg of code.split(/\|\||&&|[|;]/)) {
    const words = seg.trim().replace(/^\$\s+/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[i])) i++; // env assignments
    if (['npx', 'bunx', 'uvx', 'pipx', 'sudo', 'exec', 'time'].includes(words[i])) i++;
    if (words[i] === 'run' && words[i - 1] === 'pipx') i++;
    let cmd = null;
    let kind = null;
    let entry = null;
    const w = words[i] || '';
    const slashM = /^\/(?:[a-z0-9-]+:)?([a-z0-9][\w-]*)$/.exec(w);
    if (slashM && own.slash.has(slashM[1])) { cmd = slashM[1]; kind = 'slash'; }
    else if (own.bins.has(w)) { cmd = w; kind = 'bin'; entry = own.bins.get(w); }
    else if (/^(node|python3?|bash|sh|zsh|deno|bun|tsx|ts-node|uv)$/.test(w)) {
      let j = i + 1;
      while (j < words.length && (words[j].startsWith('-') || words[j] === 'run')) j++;
      const target = (words[j] || '').replace(/^(<[^>]+>|\$\{?[A-Za-z_]+\}?)\//, '').replace(/^\.\//, '');
      if (scripts(target)) { cmd = target; kind = 'script'; entry = target; i = j; }
    } else if (/^\.\//.test(w) && scripts(w.slice(2))) { cmd = w.slice(2); kind = 'script'; entry = cmd; }
    if (!cmd) continue;
    for (const arg of words.slice(i + 1)) {
      if (arg === '--') break; // the rest goes to another program
      const m = /^(--[a-z][a-z0-9-]*)(=|$)/.exec(arg.replace(/^["'`]|["'`,.]$/g, ''));
      if (m && m[1].length > 3 && !BUILTIN_FLAGS.has(m[1])) out.push({ cmd, kind, flag: m[1], entry });
    }
  }
  return out;
}

// Spellings a flag takes in code that defines it: --max-count, "max-count", max_count, maxCount.
// A negated flag (--no-color) may be defined as itself or by its positive form.
function spellings(flag) {
  const forms = [flag];
  for (const bare of [flag.slice(2), flag.replace(/^--no-/, '')]) {
    forms.push(`--${bare}`, bare, bare.replace(/-/g, '_'), bare.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()));
  }
  return [...new Set(forms)].filter((s) => s.length >= 3);
}

// Slash commands this change deleted or moved, still invoked in docs.
function goneSlashCommands(ctx, own) {
  const items = [];
  const gone = [];
  for (const f of ctx.files) {
    const m = f.oldPath && /(^|\/)commands\/([a-z0-9][\w-]*)\.md$/.exec(f.oldPath);
    if (m && (f.status === 'D' || f.status === 'R') && !own.slash.has(m[2])) gone.push(m[2]);
  }
  if (!gone.length) return items;
  for (const h of ctx.grep(gone.map((n) => `/${n}`))) {
    const k = ctx.kindOf(h.file);
    if (!TEXT_KINDS.has(k) || k === 'changelog' || SNAPSHOT.test(h.file) || HISTORY.test(h.text)) continue;
    for (const n of gone) {
      if (!new RegExp(`(^|[\\s\`'"(])/(?:[a-z0-9-]+:)?${escapeRe(n)}(?![\\w-])`).test(h.text)) continue;
      items.push({ check: 'doc-example-stale', severity: 'high', file: h.file, line: h.line, excerpt: h.text.trim().slice(0, 160), message: `invokes \`/${n}\`, whose command file this change deleted`, token: `/${n}` });
    }
  }
  return items;
}

// Our commands run with long flags in doc lines: the lines this change added, or every doc line
// in repo scope.
function docUses(ctx, own) {
  const scripts = (p) => ctx.headFiles.has(p) && ctx.kindOf(p) === 'code';
  const uses = [];
  for (const f of ctx.files) {
    if (!TEXT_KINDS.has(f.kind) || f.kind === 'changelog' || SKIP_KINDS.has(f.kind) || SNAPSHOT.test(f.path)) continue;
    const fenced = fenceLines(ctx.lines(f.path) || []);
    for (const a of f.added) {
      if (HISTORY.test(a.text)) continue;
      for (const part of codeParts(a.text, fenced.has(a.line))) {
        for (const u of invocations(part, own, scripts)) uses.push({ ...u, file: f.path, line: a.line, text: a.text });
      }
    }
  }
  return uses;
}

// A predicate: does some file define the flag of a use in any spelling? Code, tests and config
// define a CLI's flags; a slash command's are defined in prose, by its command, skill or agent file.
function flagDefinitions(ctx, uses) {
  const at = new Map(); // spelling -> [{file, line, kind}], where it appears as a whole word
  const index = (forms) => {
    for (const h of ctx.grep([...forms])) {
      const k = ctx.kindOf(h.file);
      for (const m of h.text.matchAll(/--[a-z0-9][a-z0-9-]*|[A-Za-z_][\w-]*/g)) {
        const w = m[0].startsWith('--') ? m[0] : m[0].replace(/-+$/, '');
        if (!forms.has(w)) continue;
        if (!at.has(w)) at.set(w, []);
        at.get(w).push({ file: h.file, line: h.line, kind: k });
      }
    }
  };
  const DEFINES = { slash: new Set(['prompt', 'code']), other: new Set(['code', 'test', 'config', 'ci', 'other']) };
  const defined = (u) => {
    const kinds = DEFINES[u.kind === 'slash' ? 'slash' : 'other'];
    return spellings(u.flag).some((sp) => (at.get(sp) || []).some((h) => kinds.has(h.kind) && !(h.file === u.file && h.line === u.line)));
  };
  // A bare one-word spelling (json, base) is on a large share of a big repo's lines, so it is
  // searched only for the flags no distinctive spelling defines.
  const plain = (sp) => /^[a-z0-9]+$/.test(sp);
  index(new Set(uses.flatMap((u) => spellings(u.flag).filter((sp) => !plain(sp)))));
  const open = uses.filter((u) => !defined(u));
  if (open.length) index(new Set(open.flatMap((u) => spellings(u.flag).filter(plain))));
  return defined;
}

function docExampleStale(ctx) {
  const own = ownCommands(ctx);
  const items = goneSlashCommands(ctx, own);
  if (!own.bins.size && !own.slash.size && ![...ctx.headFiles].some((p) => lang(p) && /(^|\/)(scripts|bin|tools)\//.test(p))) return items;
  const uses = docUses(ctx, own);
  if (!uses.length) return items;
  const defined = flagDefinitions(ctx, uses);
  // Absence of a spelling is enough for HIGH only when the command's entry file was read and
  // keeps its arguments to itself; otherwise the flag may belong to a program it calls.
  const forwards = new Map();
  const passesOn = (entry) => {
    if (!forwards.has(entry)) {
      const text = ctx.headReader.read(entry);
      forwards.set(entry, text === null ? null : passesArgsOn(text, entry));
    }
    return forwards.get(entry);
  };
  const seen = new Set();
  for (const u of uses) {
    const key = `${u.file}:${u.line}:${u.flag}`;
    if (seen.has(key) || defined(u)) continue;
    seen.add(key);
    const who = u.kind === 'slash' ? `/${u.cmd}` : u.cmd;
    const fwd = u.kind === 'slash' || !u.entry ? null : passesOn(u.entry);
    let message = u.kind === 'slash'
      ? `passes \`${u.flag}\` to \`${who}\`, but no command, skill or agent file mentions that flag`
      : `passes \`${u.flag}\` to \`${who}\`, but no code in the repo defines that flag in any spelling`;
    if (fwd) message += `; ${u.entry} hands its arguments to another program, so check whether that one takes it`;
    items.push({
      check: 'doc-example-stale',
      severity: fwd === false ? 'high' : 'review',
      file: u.file,
      line: u.line,
      excerpt: u.text.trim().slice(0, 160),
      message,
      token: u.flag,
    });
  }
  return items;
}

// --- version-mismatch --------------------------------------------------------------------

const VERSIONED = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|plugin\.json|marketplace\.json|gemini-extension\.json|manifest\.json)$/;
// Manifests whose names carry no npm scope: a plugin or extension manifest, Cargo, PyPI.
const UNSCOPED = /(^|\/)(plugin\.json|marketplace\.json|gemini-extension\.json|manifest\.json|Cargo\.toml|pyproject\.toml)$/;
const nameKey = (n) => String(n || '').toLowerCase().replace(/_/g, '-');
const bareName = (n) => nameKey(n).replace(/^@[^/]+\//, '');
const versioned = (ctx) => [...ctx.headFiles].filter((p) => VERSIONED.test(p) && !SKIP_KINDS.has(ctx.kindOf(p)) && !SNAPSHOT.test(p));

// Two manifest records describe the same package when the names match with their npm scope, or
// when one is @scope/kit and the other "kit" in a manifest that cannot carry a scope (a plugin
// manifest mirroring its npm package), as long as no other scope also publishes a "kit".
function samePackage(a, b, scopes) {
  if (nameKey(a.name) === nameKey(b.name)) return true;
  if (bareName(a.name) !== bareName(b.name)) return false;
  const plain = a.name.startsWith('@') ? b : a;
  if (plain.name.startsWith('@')) return false;
  return UNSCOPED.test(plain.file) && (scopes.get(bareName(a.name)) || new Set()).size === 1;
}

// {name, version, line} for each object in a JSON manifest that has both, with the line of
// its version value (top level and nested entries such as a marketplace's plugins).
function jsonRecords(text) {
  const out = [];
  const stack = [];
  let line = 1;
  let i = 0;
  let lastKey = null;
  let expectKey = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '{') { stack.push({ name: null, version: null, vline: 0 }); expectKey = true; i++; continue; }
    if (c === '}') {
      const o = stack.pop();
      if (o && o.name && o.version) out.push({ name: o.name, version: o.version, line: o.vline });
      expectKey = false;
      i++;
      continue;
    }
    if (c === ',') { expectKey = stack.length > 0; i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      const s = text.slice(i + 1, j);
      const top = stack[stack.length - 1];
      if (expectKey) { lastKey = s; expectKey = false; } else if (top && lastKey === 'name' && !top.name) top.name = s; else if (top && lastKey === 'version') { top.version = s; top.vline = line; }
      i = j + 1;
      continue;
    }
    if (c === '[') { expectKey = false; lastKey = null; }
    i++;
  }
  return out;
}

function tomlRecords(text) {
  const out = [];
  let table = '';
  let cur = null;
  text.split('\n').forEach((l, idx) => {
    const t = /^\s*\[([^\]]+)\]\s*$/.exec(l);
    if (t) {
      if (cur && cur.name && cur.version) out.push(cur);
      table = t[1].trim();
      cur = ['package', 'project', 'tool.poetry'].includes(table) ? { name: null, version: null, line: 0 } : null;
      return;
    }
    if (!cur) return;
    const kv = /^\s*(name|version)\s*=\s*"([^"]+)"/.exec(l);
    if (kv && kv[1] === 'name') cur.name = kv[2];
    if (kv && kv[1] === 'version') { cur.version = kv[2]; cur.line = idx + 1; }
  });
  if (cur && cur.name && cur.version) out.push(cur);
  return out;
}

function records(p, text) {
  if (!text) return [];
  return (p.endsWith('.toml') ? tomlRecords(text) : jsonRecords(text)).filter((r) => /^\d+\.\d+/.test(r.version));
}

function versionMismatch(ctx) {
  const items = [];
  if (ctx.scope !== 'diff' || !ctx.baseReader) return items;
  const bumps = [];
  for (const f of ctx.files) {
    if (!VERSIONED.test(f.path) || f.status === 'D' || SKIP_KINDS.has(f.kind) || SNAPSHOT.test(f.path)) continue;
    const before = records(f.oldPath, ctx.baseReader.read(f.oldPath));
    const after = records(f.path, ctx.headReader.read(f.path));
    for (const a of after) {
      const b = before.find((r) => nameKey(r.name) === nameKey(a.name));
      if (b && b.version !== a.version) bumps.push({ name: a.name, from: b.version, to: a.version, file: f.path, line: a.line });
    }
  }
  if (!bumps.length) return items;
  const manifests = versioned(ctx);
  const texts = ctx.headReader.readMany ? ctx.headReader.readMany(manifests) : manifests.map((p) => ctx.headReader.read(p));
  const recs = manifests.map((p, i) => records(p, texts[i]));
  // The scoped names in the repo by their bare name, to tell a mirror from a namesake.
  const scopes = new Map();
  for (const r of recs.flat()) {
    if (!r.name.startsWith('@')) continue;
    if (!scopes.has(bareName(r.name))) scopes.set(bareName(r.name), new Set());
    scopes.get(bareName(r.name)).add(nameKey(r.name));
  }
  const lines = new Map();
  manifests.forEach((p, i) => {
    for (const r of recs[i]) {
      for (const b of bumps) {
        if (p === b.file || r.version !== b.from || !samePackage({ name: r.name, file: p }, { name: b.name, file: b.file }, scopes)) continue;
        const key = `${p}:${r.line}`;
        if (lines.has(key)) continue;
        lines.set(key, true);
        items.push({
          check: 'version-mismatch',
          severity: 'high',
          file: p,
          line: r.line,
          excerpt: (texts[i].split('\n')[r.line - 1] || '').trim(),
          message: `\`${r.name}\` is still ${b.from} here; this change moved it to ${b.to} in ${b.file}`,
          token: b.from,
          fix: { fixType: 'replace-token', from: b.from, to: b.to },
        });
      }
    }
  });
  return items;
}

// A docs line this change added that pins one of the repo's packages to a version other than
// its manifest's ("npm i tool@1.2.0" when package.json says 1.3.0).
function pinnedVersions(ctx) {
  const items = [];
  if (ctx.scope !== 'diff') return items;
  const manifests = versioned(ctx);
  const texts = ctx.headReader.readMany ? ctx.headReader.readMany(manifests) : manifests.map((p) => ctx.headReader.read(p));
  // Keyed by the full name: "kit@1.0" in a doc is not the npm package @scope/kit.
  const current = new Map();
  manifests.forEach((p, i) => {
    for (const r of records(p, texts[i])) {
      const n = nameKey(r.name);
      if (bareName(r.name).length < 3) continue;
      if (!current.has(n)) current.set(n, new Set());
      current.get(n).add(r.version);
    }
  });
  if (!current.size) return items;
  for (const f of ctx.files) {
    if (!TEXT_KINDS.has(f.kind) || f.kind === 'changelog' || SNAPSHOT.test(f.path)) continue;
    for (const a of f.added) {
      if (HISTORY.test(a.text)) continue;
      for (const m of a.text.matchAll(/(?<![\w@/.-])(@?[a-z0-9][\w./-]*?)(?:@v?|==|\s+--version\s+v?)(\d+\.\d+\.\d+)(?![\w.])/gi)) {
        const n = nameKey(m[1]);
        const have = current.get(n);
        if (!have || have.has(m[2]) || have.size > 1) continue;
        items.push({ check: 'version-mismatch', severity: 'review', file: f.path, line: a.line, excerpt: a.text.trim().slice(0, 160), message: `pins \`${m[1]}\` to ${m[2]}, but its manifest says ${[...have][0]}`, token: m[2], fix: { fixType: 'replace-token', from: m[2], to: [...have][0] } });
      }
    }
  }
  return items;
}

module.exports = {
  id: 'docsync',
  scopes: ['diff', 'repo'],
  run(ctx) {
    return [...changelogMissing(ctx), ...docExampleStale(ctx), ...versionMismatch(ctx), ...pinnedVersions(ctx)];
  },
};
