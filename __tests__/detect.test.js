'use strict';
// End-to-end: build a small git repo with a base commit and a change, run the detector CLI,
// and check what it reports. Each case pairs a defect with a look-alike that must stay quiet.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DETECT = path.join(__dirname, '..', 'scripts', 'detect.js');
const TMP = process.env.DESLOP_TEST_TMP || os.tmpdir();
const roots = [];

function repo(base, change, { message = 'change', commit = true } = {}) {
  const root = fs.mkdtempSync(path.join(TMP, 'deslop-'));
  roots.push(root);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  write(root, base);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  write(root, change);
  if (commit) {
    git('add', '-A');
    git('commit', '-q', '-m', message);
  }
  return root;
}

function write(root, files) {
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(root, p);
    if (content === null) { fs.rmSync(full, { force: true }); continue; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function detect(root, ...args) {
  const r = spawnSync('node', [DETECT, root, '--base=main', '--json', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout).items;
}

const checks = (items) => items.map((i) => `${i.check}@${i.file}:${i.line}`);

afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('stale mentions', () => {
  test('a deleted script still named in an untouched doc', () => {
    const root = repo(
      { 'scripts/old-install.sh': '#!/bin/sh\necho hi\n', 'docs/setup.md': '# Setup\n\nRun scripts/old-install.sh first.\n', 'docs/history.md': '- scripts/old-install.sh was removed in 2.0\n' },
      { 'scripts/old-install.sh': null, 'scripts/install.sh': '#!/bin/sh\necho hi\n' },
    );
    const items = detect(root);
    expect(checks(items)).toContain('stale-mention@docs/setup.md:3');
    // A line that records the removal is history, not a stale claim.
    expect(checks(items).some((c) => c.includes('docs/history.md'))).toBe(false);
  });

  test('a renamed file carries its new path as the fix', () => {
    const root = repo(
      { 'tools/build.sh': '#!/bin/sh\n', 'README.md': 'Build with tools/build.sh\n' },
      { 'tools/build.sh': null, 'tools/make-release.sh': '#!/bin/sh\n' },
    );
    const item = detect(root).find((i) => i.check === 'stale-mention' && i.file === 'README.md');
    expect(item.fix).toEqual({ fixType: 'replace-token', from: 'tools/build.sh', to: 'tools/make-release.sh' });
  });

  test('a removed environment variable still documented', () => {
    const root = repo(
      { 'src/run.py': 'import os\nlimit = os.environ.get("APP_MAX_WORKERS", "4")\n', 'docs/config.md': '| `APP_MAX_WORKERS` | 4 | worker count |\n' },
      { 'src/run.py': 'import os\nlimit = 4\n' },
    );
    expect(checks(detect(root))).toContain('stale-mention@docs/config.md:1');
  });

  test('a count changed in one file but not its copy, and not in an unrelated count', () => {
    const root = repo(
      { 'README.md': 'Ships 412 rules.\n', 'site/index.html': '<p>412 rules</p>\n<p>412 users</p>\n' },
      { 'README.md': 'Ships 457 rules.\n' },
    );
    const items = detect(root);
    expect(checks(items)).toContain('stale-mention@site/index.html:1');
    expect(checks(items)).not.toContain('stale-mention@site/index.html:2');
  });

  test('a version left in a frozen versioned-docs copy is not reported', () => {
    const root = repo(
      { 'Cargo.toml': '[package]\nname = "x"\nversion = "0.4.1"\n', 'website/versioned_docs/version-0.4.1/intro.md': 'x version 0.4.1\n' },
      { 'Cargo.toml': '[package]\nname = "x"\nversion = "0.4.2"\n' },
    );
    expect(detect(root).filter((i) => i.check === 'stale-mention')).toEqual([]);
  });
});

describe('references', () => {
  test('a doc cites a path that does not exist, but not an example or a glob', () => {
    const root = repo(
      { 'lib/a.js': 'module.exports = 1;\n', 'README.md': '# x\n' },
      { 'README.md': '# x\n\nSee lib/b.js for details.\nRun with lib/*.js.\nInstalled under $HOME/.tool/lib/c.js.\n' },
    );
    const missing = detect(root).filter((i) => i.check === 'missing-path').map((i) => i.token);
    expect(missing).toEqual(['lib/b.js']);
  });

  test('a link to a heading that does not exist', () => {
    const root = repo(
      { 'docs/guide.md': '# Guide\n\n## Install steps\n\ntext\n', 'README.md': '# x\n' },
      { 'README.md': '# x\n\n[ok](docs/guide.md#install-steps) and [bad](docs/guide.md#setup)\n' },
    );
    const anchors = detect(root).filter((i) => i.check === 'broken-anchor');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].message).toContain('#setup');
  });

  test('a committed path into a developer checkout', () => {
    const root = repo(
      { 'run.py': 'print(1)\n' },
      { 'run.py': 'import sys\nsys.path.insert(0, "/home/dev/projects/wt-feature/lib")\nprint(1)\n' },
    );
    expect(checks(detect(root))).toContain('local-path@run.py:2');
  });
});

describe('comments and text', () => {
  test('review history in a code comment', () => {
    const root = repo(
      { 'src/a.rs': 'fn main() {}\n' },
      { 'src/a.rs': '// revuto round 2: guard the empty case\nfn main() {}\n' },
    );
    expect(checks(detect(root))).toContain('review-provenance@src/a.rs:1');
  });

  test('new code inserted between a doc comment and its item', () => {
    const root = repo(
      { 'src/lib.rs': '/// Parses the header.\npub fn parse() {}\n' },
      { 'src/lib.rs': '/// Parses the header.\npub fn validate() {}\n\npub fn parse() {}\n' },
    );
    expect(checks(detect(root))).toContain('displaced-doc-comment@src/lib.rs:2');
  });

  test('a docs-only claim on a change that edits code; a comment-only code edit passes', () => {
    const code = repo({ 'a.js': 'const x = 1;\n' }, { 'a.js': 'const x = 2;\n' }, { message: 'docs-only: fix wording' });
    expect(detect(code).some((i) => i.check === 'scope-claim')).toBe(true);
    const comment = repo({ 'a.js': 'const x = 1;\n' }, { 'a.js': '// the default\nconst x = 1;\n' }, { message: 'docs-only: explain x' });
    expect(detect(comment).some((i) => i.check === 'scope-claim')).toBe(false);
  });

  test('conflict markers and an em dash; the em dash can be turned off', () => {
    const root = repo(
      { 'README.md': '# x\n' },
      { 'README.md': '# x\n<<<<<<< HEAD\nA tool — for things.\n>>>>>>> other\n' },
    );
    const got = detect(root).map((i) => i.check);
    expect(got).toContain('merge-residue');
    expect(got).toContain('em-dash');
    write(root, { '.deslop.json': '{"style": {"emDash": false}}' });
    expect(detect(root).map((i) => i.check)).not.toContain('em-dash');
  });

  test('a rewrite that drops a rule', () => {
    const before = ['# Agent', '', ...Array.from({ length: 10 }, (_, i) => `- Step ${i} reads the file and reports.`), '- Never push to main without a reviewed pull request.', ''].join('\n');
    const root = repo({ 'AGENTS.md': before }, { 'AGENTS.md': '# Agent\n\nRead the file and report.\n' });
    const dropped = detect(root).filter((i) => i.check === 'dropped-rule');
    expect(dropped.some((i) => i.excerpt.includes('Never push to main'))).toBe(true);
  });
});

describe('tests', () => {
  test('a new test without an assertion; one that asserts through a helper passes', () => {
    const root = repo(
      { 'tests/test_a.py': 'def check(x):\n    assert x\n' },
      { 'tests/test_a.py': 'def check(x):\n    assert x\n\ndef test_runs():\n    print("ok")\n\ndef test_helper():\n    check(1)\n' },
    );
    const got = detect(root).filter((i) => i.check === 'test-cannot-fail');
    expect(got.map((i) => i.line)).toEqual([4]);
  });

  test('a shell test that always reports success', () => {
    const root = repo({ 'README.md': 'x\n' }, { 'tests/run.sh': '#!/bin/sh\nrun_thing 2>/dev/null\necho PASS\n' });
    expect(detect(root).some((i) => i.check === 'test-cannot-fail' && i.file === 'tests/run.sh')).toBe(true);
  });
});

describe('unwired additions and secrets', () => {
  test('a new function nothing calls', () => {
    const root = repo(
      { 'src/a.py': 'def used():\n    return 1\n\nprint(used())\n' },
      { 'src/a.py': 'def used():\n    return 1\n\ndef helper_never_called():\n    return 2\n\nprint(used())\n' },
    );
    expect(checks(detect(root))).toContain('no-caller@src/a.py:4');
  });

  test('a call is found even when its file mentions many other new names', () => {
    // Regression: a per-file match cap in the search hid the call line behind earlier matches.
    const defs = Array.from({ length: 30 }, (_, i) => `function helperNumber${i}() { return ${i}; }`).join('\n');
    const calls = Array.from({ length: 30 }, (_, i) => `helperNumber${i}();`).join('\n');
    const root = repo({ 'src/a.js': '1;\n' }, { 'src/a.js': `${defs}\n${calls}\nfunction lateHelper() { return 1; }\nlateHelper();\n` });
    expect(detect(root).filter((i) => i.check === 'no-caller')).toEqual([]);
  });

  test('a new module loaded by name is wired; one nothing loads is not', () => {
    const root = repo(
      { 'lib/index.js': "module.exports = ['alpha'].map((n) => require(`./checks/${n}`));\n", 'lib/checks/alpha.js': 'module.exports = 1;\n' },
      { 'lib/index.js': "module.exports = ['alpha', 'bravo'].map((n) => require(`./checks/${n}`));\n", 'lib/checks/bravo.js': 'module.exports = 2;\n', 'scripts/orphan-tool.sh': '#!/bin/sh\necho x\n' },
    );
    const files = detect(root).filter((i) => i.check === 'no-caller').map((i) => i.file);
    expect(files).toEqual(['scripts/orphan-tool.sh']);
  });

  test('a committed key in an added line', () => {
    const root = repo({ 'a.env': 'X=1\n' }, { 'a.env': 'X=1\nAWS_KEY=AKIAABCDEFGHIJKLMNOP\n' });
    const s = detect(root).find((i) => i.check === 'secret');
    expect(s).toBeDefined();
    expect(s.excerpt).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });
});

describe('scopes and inputs', () => {
  test('clean change reports nothing', () => {
    const root = repo({ 'a.js': 'module.exports = 1;\n' }, { 'a.js': 'module.exports = 2;\n' });
    expect(detect(root)).toEqual([]);
  });

  test('--worktree sees uncommitted changes', () => {
    const root = repo({ 'src/a.rs': 'fn main() {}\n' }, { 'src/a.rs': '// per review: keep\nfn main() {}\n' }, { commit: false });
    expect(detect(root)).toEqual([]);
    expect(detect(root, '--worktree').map((i) => i.check)).toContain('review-provenance');
  });

  test('repo scope narrowed to a path', () => {
    const root = repo({ 'docs/a.md': 'See lib/missing.js\n', 'lib/x.js': '1\n', 'other/b.md': 'See lib/gone.js\n' }, { 'docs/c.md': 'x\n' });
    const r = spawnSync('node', [DETECT, root, '--scope=docs', '--json'], { encoding: 'utf8' });
    const files = JSON.parse(r.stdout).items.map((i) => i.file);
    expect(files).toContain('docs/a.md');
    expect(files).not.toContain('other/b.md');
  });

  test('PR body from stdin is checked', () => {
    const root = repo({ 'a.js': 'const x = 1;\n' }, { 'a.js': 'const x = 2;\n' });
    const r = spawnSync('node', [DETECT, root, '--base=main', '--json', '--pr-body=-'], { input: 'Test-only change.\n', encoding: 'utf8' });
    expect(JSON.parse(r.stdout).items.map((i) => i.check)).toContain('scope-claim');
  });

  test('not a git repository is an error with exit 1', () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'deslop-nogit-'));
    roots.push(dir);
    const r = spawnSync('node', [DETECT, dir], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a git repository');
  });
});
