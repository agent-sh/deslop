'use strict';
// Docs that no longer match the code, beyond one stale mention (drift.js covers those):
// - changelog-missing: a user-visible change (a CLI flag, an env var the code reads, a command,
//   skill or agent file, a package bin, or a feat/fix/perf commit over code) in a repo that keeps
//   an Unreleased section, with no changelog entry.
// - doc-example-stale: a docs example runs a command this change removed: a slash command whose
//   file it deleted or moved, or a package bin it took out of package.json. Flags it removed or
//   renamed are stale-mention findings (drift.js reads the same option definitions).
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

// A package.json's command names. A string "bin" is named after the package without its scope,
// as npm installs it.
function binsOf(text) {
  try {
    const pkg = JSON.parse(text);
    if (typeof pkg.bin === 'string') return new Set([String(pkg.name || '').replace(/^@[^/]+\//, '')]);
    return new Set(Object.keys(pkg.bin || {}));
  } catch { return new Set(); }
}

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

const COMMAND_FILE = /(^|\/)commands\/([a-z0-9][\w-]*)\.md$/;
const PKG = /(^|\/)package\.json$/;

// Commands this change removed, [{name, kind, to?}]: slash commands whose file it deleted or
// moved (to: the new name when it moved to another command file; drift.js covers the old path,
// not the /name people type), and package bins no package.json declares any more.
function removedCommands(ctx) {
  const out = [];
  const slash = new Set();
  for (const p of ctx.headFiles) {
    const m = COMMAND_FILE.exec(p);
    if (m && !SNAPSHOT.test(p)) slash.add(m[2]);
  }
  const bins = [];
  for (const f of ctx.files) {
    if (!f.oldPath || SNAPSHOT.test(f.oldPath)) continue;
    const m = COMMAND_FILE.exec(f.oldPath);
    if (m && (f.status === 'D' || f.status === 'R') && !slash.has(m[2])) {
      const to = f.status === 'R' ? COMMAND_FILE.exec(f.path) : null;
      out.push({ name: m[2], kind: 'slash', to: to ? to[2] : undefined });
    }
    if (PKG.test(f.oldPath) && ctx.baseReader) {
      const before = binsOf(ctx.baseReader.read(f.oldPath) || '');
      const after = f.status === 'D' ? new Set() : binsOf(ctx.headReader.read(f.path) || '');
      for (const b of before) if (!after.has(b) && b.length >= 3) bins.push({ name: b, kind: 'bin' });
    }
  }
  if (bins.length) {
    // Still a command when another package.json declares it.
    const pkgs = [...ctx.headFiles].filter((p) => PKG.test(p) && !SKIP_KINDS.has(ctx.kindOf(p)) && !SNAPSHOT.test(p));
    const live = new Set();
    for (const t of ctx.headReader.readMany(pkgs)) for (const b of binsOf(t || '')) live.add(b);
    out.push(...bins.filter((b) => !live.has(b.name)));
  }
  return out;
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

// Whether a piece of shell code runs the command: it is the first word of a pipeline segment,
// after environment assignments and a launcher such as npx or sudo.
function runs(code, name) {
  return code.split(/\|\||&&|[|;]/).some((seg) => {
    const words = seg.trim().replace(/^\$\s+/, '').split(/\s+/);
    let i = 0;
    while (i < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[i])) i++;
    if (['npx', 'bunx', 'pnpx', 'sudo', 'exec', 'time'].includes(words[i])) i++;
    return words[i] === name;
  });
}

function docExampleStale(ctx) {
  const items = [];
  const gone = removedCommands(ctx);
  if (!gone.length) return items;
  const fenced = new Map();
  for (const h of ctx.grep(gone.map((c) => (c.kind === 'slash' ? `/${c.name}` : c.name)))) {
    const k = ctx.kindOf(h.file);
    if (!TEXT_KINDS.has(k) || k === 'changelog' || SNAPSHOT.test(h.file) || HISTORY.test(h.text)) continue;
    for (const c of gone) {
      let fix;
      if (c.kind === 'slash') {
        if (!new RegExp(`(^|[\\s\`'"(])/(?:[a-z0-9-]+:)?${escapeRe(c.name)}(?![\\w-])`).test(h.text)) continue;
        if (c.to && h.text.includes(`/${c.name}`)) fix = { fixType: 'replace-token', from: `/${c.name}`, to: `/${c.to}` };
      } else {
        if (!h.text.includes(c.name)) continue;
        if (!fenced.has(h.file)) fenced.set(h.file, fenceLines(ctx.lines(h.file) || []));
        if (!codeParts(h.text, fenced.get(h.file).has(h.line)).some((part) => runs(part, c.name))) continue;
      }
      const who = c.kind === 'slash' ? `/${c.name}` : c.name;
      const what = c.kind === 'slash' ? 'command file' : 'package bin';
      items.push({
        check: 'doc-example-stale',
        severity: 'high',
        file: h.file,
        line: h.line,
        excerpt: h.text.trim().slice(0, 160),
        message: c.to ? `runs \`${who}\`, which this change renamed to \`/${c.to}\`` : `runs \`${who}\`, whose ${what} this change removed`,
        token: who,
        fix,
      });
    }
  }
  return items;
}

// --- version-mismatch --------------------------------------------------------------------

const VERSIONED = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|plugin\.json|marketplace\.json|gemini-extension\.json|manifest\.json)$/;
// A package is its exact name: @one/kit, @two/kit, kit, foo-bar and foo_bar are five packages,
// as npm sees them. Folding names together reported versions of unrelated packages.
// Manifests under test or fixture paths pin old versions on purpose (a fixture for the old
// format), so they are neither a bump to follow nor a mirror to update.
const isManifest = (ctx, p) => VERSIONED.test(p) && !SKIP_KINDS.has(ctx.kindOf(p)) && ctx.kindOf(p) !== 'test' && !SNAPSHOT.test(p);
const versioned = (ctx) => [...ctx.headFiles].filter((p) => isManifest(ctx, p));

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
    if (f.status === 'D' || !isManifest(ctx, f.path)) continue;
    const before = records(f.oldPath, ctx.baseReader.read(f.oldPath));
    const after = records(f.path, ctx.headReader.read(f.path));
    for (const a of after) {
      const b = before.find((r) => r.name === a.name);
      if (b && b.version !== a.version) bumps.push({ name: a.name, from: b.version, to: a.version, file: f.path, line: a.line });
    }
  }
  if (!bumps.length) return items;
  const manifests = versioned(ctx);
  const texts = ctx.headReader.readMany(manifests);
  const lines = new Map();
  manifests.forEach((p, i) => {
    for (const r of records(p, texts[i])) {
      for (const b of bumps) {
        if (p === b.file || r.name !== b.name || r.version !== b.from) continue;
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
  const texts = ctx.headReader.readMany(manifests);
  const current = new Map();
  manifests.forEach((p, i) => {
    for (const r of records(p, texts[i])) {
      const n = r.name;
      if (n.replace(/^@[^/]+\//, '').length < 3) continue;
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
        const n = m[1];
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
