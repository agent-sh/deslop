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

  test('a deleted directory and a deleted image are still cited', () => {
    const root = repo(
      { 'tools/runners/run-all.sh': '#!/bin/sh\n', 'docs/arch.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0]), 'docs/a.md': 'Runners live in tools/runners/.\n\n![arch](docs/arch.png)\n' },
      { 'tools/runners/run-all.sh': null, 'docs/arch.png': null },
    );
    const tokens = detect(root).filter((i) => i.check === 'stale-mention').map((i) => i.token);
    expect(tokens).toEqual(expect.arrayContaining(['tools/runners/', 'docs/arch.png']));
  });

  test('paths with spaces and non-ASCII names are read correctly', () => {
    const root = repo({ 'src/my mod.rs': 'fn a() {}\n', 'src/caf\u00e9.rs': 'fn b() {}\n' }, { 'src/my mod.rs': '// revuto round 2: keep\nfn a() {}\n', 'src/caf\u00e9.rs': '// revuto round 3: keep\nfn b() {}\n' });
    const files = detect(root).filter((i) => i.check === 'review-provenance').map((i) => i.file).sort();
    expect(files).toEqual(['src/caf\u00e9.rs', 'src/my mod.rs']);
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

  test('a package version bump: the install line is stale, the frozen versioned docs are not', () => {
    const root = repo(
      { 'Cargo.toml': '[package]\nname = "toolkit"\nversion = "0.4.1"\n', 'README.md': 'cargo install toolkit@0.4.1\n', 'website/versioned_docs/version-0.4.1/intro.md': 'toolkit 0.4.1\n' },
      { 'Cargo.toml': '[package]\nname = "toolkit"\nversion = "0.4.2"\n' },
    );
    const files = detect(root).filter((i) => i.check === 'stale-mention').map((i) => i.file);
    expect(files).toEqual(['README.md']);
  });
});

describe('second review round', () => {
  test('a binary file with a tab in its name can be deleted without a crash', () => {
    const root = repo({ 'docs/arch\tv2.png': Buffer.from([0x89, 0x50, 0, 1]), 'README.md': '# x\n' }, { 'docs/arch\tv2.png': null });
    expect(() => detect(root)).not.toThrow();
  });

  test('a docstring-only commit stays docs-only after a later commit shifts the file', () => {
    const root = repo({ 'a.py': 'def f():\n    \"\"\"Doc.\"\"\"\n    return 1\n' }, {}, { commit: false });
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
    write(root, { 'a.py': 'def f():\n    \"\"\"Doc.\n\n    More words.\n    \"\"\"\n    return 1\n' });
    git('commit', '-q', '-am', 'docs-only: expand f docstring');
    write(root, { 'a.py': 'import os\nimport sys\nimport re\n\ndef f():\n    \"\"\"Doc.\n\n    More words.\n    \"\"\"\n    return 1\n' });
    git('commit', '-q', '-am', 'feat: imports');
    expect(detect(root).some((i) => i.check === 'scope-claim')).toBe(false);
  });

  test('a claim in a commit body bullet is not a claim about the commit; two real claims both show', () => {
    const body = repo({ 'a.js': 'const x = 1;\n' }, { 'a.js': 'const x = 2;\n' }, { message: 'feat: move x\n\n- Test-only helpers stay in tests/helpers.js.' });
    expect(detect(body).some((i) => i.check === 'scope-claim')).toBe(false);
    const two = repo({ 'a.js': 'const x = 1;\n', 'b.js': 'const y = 1;\n' }, { 'a.js': 'const x = 2;\n' }, { message: 'docs-only: a' });
    write(two, { 'b.js': 'const y = 2;\n' });
    execFileSync('git', ['-C', two, 'commit', '-q', '-am', 'docs-only: b']);
    expect(detect(two).filter((i) => i.check === 'scope-claim')).toHaveLength(2);
  });

  test('a major version bump finds the install line; a dependency range in another manifest is fine', () => {
    const root = repo(
      { 'package.json': '{\n  "name": "toolkit",\n  "version": "1.3.0"\n}\n', 'README.md': 'npm i toolkit@1.3.0\n', 'apps/web/package.json': '{\n  "dependencies": { "toolkit": "^1.3.0" }\n}\n' },
      { 'package.json': '{\n  "name": "toolkit",\n  "version": "2.0.0"\n}\n' },
    );
    const files = detect(root).filter((i) => i.check === 'stale-mention').map((i) => i.file);
    expect(files).toEqual(['README.md']);
  });

  test('a top-level directory deleted with git rm -r is still cited with its slash', () => {
    const root = repo({ 'runners/a.sh': '#!/bin/sh\n', 'README.md': 'Runners live in runners/.\n' }, { 'runners/a.sh': null });
    expect(detect(root).some((i) => i.check === 'stale-mention' && i.token === 'runners/')).toBe(true);
  });

  test('a byte order mark and an Nx comment are not broken JSON', () => {
    const root = repo({ 'README.md': 'x\n' }, { 'tsconfig.json': '\uFEFF{ "compilerOptions": {} }\n', 'apps/x/project.json': '{\n  // targets\n  "name": "x"\n}\n' });
    expect(detect(root).filter((i) => i.check === 'broken-file')).toEqual([]);
  });

  test('a shell test whose only guarded line is unrelated still cannot fail', () => {
    const root = repo({ 'README.md': 'x\n' }, {
      'tests/a.sh': '#!/bin/sh\ncommand -v jq >/dev/null && echo "jq OK"\nrun_thing 2>/dev/null; echo PASS\n',
      'tests/b.sh': '#!/bin/sh\nrun_thing && echo PASS || echo FAIL\n',
    });
    const files = detect(root).filter((i) => i.check === 'test-cannot-fail').map((i) => i.file).sort();
    expect(files).toEqual(['tests/a.sh', 'tests/b.sh']);
  });

  test('"(round 2)" is review history; "each review round re-runs" is not', () => {
    const root = repo({ 'a.js': '1;\n', 'b.js': '2;\n' }, { 'a.js': '// fixed the retry (round 2)\n1;\n', 'b.js': '// Each review round re-runs the linter\n2;\n' });
    expect(detect(root).filter((i) => i.check === 'review-provenance').map((i) => i.file)).toEqual(['a.js']);
  });

  test('camelCase record files are data; a symlinked subdirectory runs from the top level', () => {
    const root = repo({ 'pkg/docs/a.md': '# a\n', 'pkg/src/a.js': '1\n' }, { 'pkg/docs/a.md': '# a\n\nSee [a](../src/a.js).\n', 'out/testResults.json': '{"broken": }\n' });
    const link = `${root}-link`;
    fs.symlinkSync(root, link);
    roots.push(link);
    const r = spawnSync('node', [DETECT, path.join(link, 'pkg'), '--base=main', '--json'], { encoding: 'utf8' });
    const checks = JSON.parse(r.stdout).items.map((i) => i.check);
    expect(checks).not.toContain('missing-path');
    expect(checks).not.toContain('broken-file');
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

  test('a heading rename breaks a link in an untouched doc; a stray % does not stop the check', () => {
    const root = repo(
      { 'docs/guide.md': '# Guide\n\n## Install steps\n', 'docs/other.md': 'See [install](guide.md#install-steps) and [x](guide.md#50%-done).\n', 'docs/notes.md': '# Notes\n' },
      { 'docs/guide.md': '# Guide\n\n## Setup\n' },
    );
    const anchors = detect(root).filter((i) => i.check === 'broken-anchor').map((i) => `${i.file}:${i.token}`);
    expect(anchors).toContain('docs/other.md:docs/guide.md#install-steps');
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

  test('a tool describing its own job is not review history', () => {
    const root = repo({ 'lib/a.js': 'module.exports = 1;\n' }, { 'lib/a.js': '// Framework-specific code review patterns for the agent to review findings\nmodule.exports = 1;\n' });
    expect(detect(root).some((i) => i.check === 'review-provenance')).toBe(false);
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

  test('a docs-only commit is judged by its own files, not by the rest of the branch', () => {
    const root = repo({ 'a.js': 'const x = 1;\n', 'README.md': '# x\n' }, { 'a.js': 'const x = 2;\n' }, { message: 'feat: change x' });
    write(root, { 'README.md': '# x\n\nWording.\n' });
    execFileSync('git', ['-C', root, 'commit', '-q', '-am', 'docs-only: fix wording']);
    expect(detect(root).some((i) => i.check === 'scope-claim')).toBe(false);
  });

  test('a comment-only commit on a file an earlier commit changed is not a false docs-only claim', () => {
    const root = repo({ 'a.js': 'const x = 1;\n' }, { 'a.js': 'const x = 2;\n' }, { message: 'feat: change x' });
    write(root, { 'a.js': '// x is the retry count\nconst x = 2;\n' });
    execFileSync('git', ['-C', root, 'commit', '-q', '-am', 'docs-only: explain x']);
    expect(detect(root).some((i) => i.check === 'scope-claim')).toBe(false);
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

  test('shell tests that can fail through errexit or a guarded marker are fine', () => {
    const root = repo({ 'README.md': 'x\n' }, {
      'tests/a.sh': '#!/bin/bash -e\nrun_thing\necho PASS\n',
      'tests/b.sh': '#!/bin/sh\nset -o errexit\nrun_thing\necho OK\n',
      'tests/c.sh': '#!/bin/sh\nrun_thing && echo PASS\n',
    });
    expect(detect(root).filter((i) => i.check === 'test-cannot-fail')).toEqual([]);
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

describe('companions', () => {
  test('a declared pair where only one side changed', () => {
    const root = repo({ 'rules.json': '{}\n', 'docs/rules.md': '# Rules\n' }, { 'rules.json': '{"a": 1}\n' });
    write(root, { '.deslop.json': JSON.stringify({ together: [{ when: 'rules.json', also: 'docs/rules.md', message: 'rules.json and docs/rules.md change together' }] }) });
    const c = detect(root).find((i) => i.check === 'missing-companion');
    expect(c.message).toBe('rules.json and docs/rules.md change together');
  });

  test('commits that touched the file alone count against a mined pair', () => {
    const root = repo({ 'src/hot.py': 'x = 0\n', 'docs/plan.md': 'x is 0\n' }, {}, { commit: false });
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
    git('checkout', '-q', 'main');
    for (let i = 1; i <= 6; i++) {
      write(root, { 'src/hot.py': `x = ${i}\n`, 'docs/plan.md': `x is ${i}\n` });
      git('commit', '-q', '-am', `pair ${i}`);
    }
    for (let i = 7; i <= 20; i++) {
      write(root, { 'src/hot.py': `x = ${i}\n` });
      git('commit', '-q', '-am', `alone ${i}`);
    }
    git('checkout', '-q', '-B', 'feature');
    write(root, { 'src/hot.py': 'x = 99\n' });
    git('commit', '-q', '-am', 'only code');
    expect(detect(root).some((i) => i.check === 'missing-companion')).toBe(false);
  });

  test('a file that history always changes with the edited one', () => {
    const root = repo({ 'src/plan.py': 'x = 0\n', 'docs/plan.md': 'x is 0\n' }, {}, { commit: false });
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
    git('checkout', '-q', 'main');
    for (let i = 1; i <= 6; i++) {
      write(root, { 'src/plan.py': `x = ${i}\n`, 'docs/plan.md': `x is ${i}\n` });
      git('commit', '-q', '-am', `step ${i}`);
    }
    git('checkout', '-q', '-B', 'feature');
    write(root, { 'src/plan.py': 'x = 7\n' });
    git('commit', '-q', '-am', 'only code');
    const c = detect(root).find((i) => i.check === 'missing-companion');
    expect(c.file).toBe('docs/plan.md');
  });
});

describe('doc sync', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n- First release.\n';

  test('a new CLI flag with no changelog entry; an entry, a moved flag or a release-time changelog stay quiet', () => {
    const base = { 'CHANGELOG.md': changelog, 'src/cli.js': "program.option('--alpha', 'a');\n", 'src/extra.js': "program.option('--gamma-mode', 'g');\n" };
    const missing = repo(base, { 'src/cli.js': "program.option('--alpha', 'a');\nprogram.option('--beta-mode', 'b');\n" });
    const item = detect(missing).find((i) => i.check === 'changelog-missing');
    expect(item).toMatchObject({ file: 'CHANGELOG.md', line: 3 });
    expect(item.message).toContain('--beta-mode');
    const noted = repo(base, { 'src/cli.js': "program.option('--alpha', 'a');\nprogram.option('--beta-mode', 'b');\n", 'CHANGELOG.md': changelog.replace('## [Unreleased]\n', '## [Unreleased]\n\n- `--beta-mode`.\n') });
    expect(detect(noted).some((i) => i.check === 'changelog-missing')).toBe(false);
    const moved = repo(base, { 'src/extra.js': '', 'src/cli.js': "program.option('--alpha', 'a');\nprogram.option('--gamma-mode', 'g');\n" });
    expect(detect(moved).some((i) => i.check === 'changelog-missing')).toBe(false);
    const generated = repo({ ...base, 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n- First release.\n' }, { 'src/cli.js': "program.option('--alpha', 'a');\nprogram.option('--beta-mode', 'b');\n" });
    expect(detect(generated).some((i) => i.check === 'changelog-missing')).toBe(false);
  });

  test('a feat commit over code with no changelog entry; a refactor commit stays quiet', () => {
    const base = { 'CHANGELOG.md': changelog, 'src/core.js': 'module.exports = 0;\n' };
    const feat = repo(base, { 'src/core.js': 'module.exports = 1;\n' }, { message: 'feat(core): return one' });
    const item = detect(feat).find((i) => i.check === 'changelog-missing');
    expect(item.message).toContain('commits "feat(core): return one"');
    const refactor = repo(base, { 'src/core.js': 'module.exports = 1;\n' }, { message: 'refactor: return one' });
    expect(detect(refactor).some((i) => i.check === 'changelog-missing')).toBe(false);
  });

  test('a flag no file spells is not reported: argparse abbreviations, delegated parsers and unknown CLIs all accept some', () => {
    const root = repo(
      {
        'package.json': '{"name": "tool", "version": "1.0.0", "bin": {"tool": "cli.js"}}\n',
        'cli.js': "if (args.includes('--json')) print();\n",
        'scripts/cli.py': 'import argparse\n\nparser = argparse.ArgumentParser()\nparser.add_argument("--logging-directory")\nparser.parse_args()\n',
        'scripts/wrap.py': 'from helper import main\n\nmain()\n',
        'scripts/helper.py': 'import subprocess, sys\n\n\ndef main():\n    subprocess.run(["git", *sys.argv[1:]])\n',
        'README.md': '# tool\n',
      },
      { 'README.md': '# tool\n\n```\npython scripts/cli.py --logging-dir /tmp\npython scripts/wrap.py --exec-path\ntool --fast-mode\npython scripts/cli.py --help\n```\n' },
    );
    expect(detect(root).filter((i) => i.check === 'doc-example-stale')).toEqual([]);
  });

  test('a flag this change removed or renamed is still passed in a docs example', () => {
    const base = { 'src/cli.js': "program.option('--fast-mode', 'f');\nprogram.option('--dry-plan', 'd');\n", 'README.md': '# tool\n\n```\ntool --fast-mode\ntool --dry-plan\n```\n' };
    const root = repo(base, { 'src/cli.js': "program.option('--dry-run-plan', 'd');\n" });
    const items = detect(root).filter((i) => i.file === 'README.md');
    expect(items.map((i) => `${i.check}:${i.line}:${i.token}`).sort()).toEqual(['stale-mention:4:--fast-mode', 'stale-mention:5:--dry-plan']);
    expect(items.find((i) => i.token === '--dry-plan').fix).toEqual({ fixType: 'replace-token', from: '--dry-plan', to: '--dry-run-plan' });
  });

  test('a slash command whose file this change deleted is still invoked in a doc', () => {
    const root = repo(
      { 'commands/old-scan.md': '# old\n', 'README.md': 'Run `/old-scan` first.\nSee src/old-scan for code.\n', 'CHANGELOG.md': '- `/old-scan` added.\n' },
      { 'commands/old-scan.md': null, 'commands/scan.md': '# scan\n' },
    );
    const items = detect(root).filter((i) => i.check === 'doc-example-stale');
    expect(items.map((i) => `${i.file}:${i.line}`)).toEqual(['README.md:1']);
  });

  test('a renamed slash command is invoked by its old name; the fix names the new one', () => {
    const root = repo({ 'commands/old-scan.md': '# scan\n\nScans the tree.\n', 'README.md': 'Run `/old-scan` first.\n' }, { 'commands/old-scan.md': null, 'commands/tree-scan.md': '# scan\n\nScans the tree.\n' });
    const items = detect(root).filter((i) => i.check === 'doc-example-stale');
    expect(items.map((i) => [i.line, i.message, i.fix])).toEqual([[1, 'runs `/old-scan`, which this change renamed to `/tree-scan`', { fixType: 'replace-token', from: '/old-scan', to: '/tree-scan' }]]);
  });

  test('a package bin this change removed is still run in a doc; prose naming it and a bin another package keeps pass', () => {
    const root = repo(
      {
        'package.json': '{"name": "kit", "version": "1.0.0", "bin": {"kit": "cli.js", "kit-sync": "sync.js", "kit-lint": "lint.js"}}\n',
        'other/package.json': '{"name": "other", "version": "1.0.0", "bin": {"kit-lint": "lint.js"}}\n',
        'README.md': '# kit\n\n```\nkit-sync --all\nkit --help\nkit-lint .\n```\n\nOr `npx kit-sync`. The kit-sync tool was handy.\n',
      },
      { 'package.json': '{"name": "kit", "version": "1.0.0", "bin": {"kit": "cli.js"}}\n' },
    );
    const items = detect(root).filter((i) => i.check === 'doc-example-stale');
    expect(items.map((i) => `${i.line}:${i.token}`)).toEqual(['4:kit-sync', '9:kit-sync']);
  });

  test('a version moved in one manifest and not in the plugin manifest of the same package', () => {
    const root = repo(
      { 'package.json': '{\n  "name": "kit",\n  "version": "1.0.0"\n}\n', '.claude-plugin/plugin.json': '{\n  "name": "kit",\n  "version": "1.0.0"\n}\n', 'other/package.json': '{\n  "name": "other",\n  "version": "1.0.0"\n}\n' },
      { 'package.json': '{\n  "name": "kit",\n  "version": "1.1.0"\n}\n' },
    );
    const items = detect(root).filter((i) => i.check === 'version-mismatch');
    expect(items.map((i) => `${i.file}:${i.line}:${i.severity}`)).toEqual(['.claude-plugin/plugin.json:3:high']);
    expect(items[0].fix).toEqual({ fixType: 'replace-token', from: '1.0.0', to: '1.1.0' });
  });

  test('manifests under test and fixture paths are neither bumps to follow nor mirrors to update', () => {
    const pkg = (version) => `{\n  "name": "kit",\n  "version": "${version}"\n}\n`;
    const files = { 'package.json': pkg('1.0.0'), '.claude-plugin/plugin.json': pkg('1.0.0'), 'tests/fixtures/v1/package.json': pkg('1.0.0') };
    const root = repo(files, { 'package.json': pkg('1.1.0') });
    expect(detect(root).filter((i) => i.check === 'version-mismatch').map((i) => i.file)).toEqual(['.claude-plugin/plugin.json']);
    const fixture = repo(files, { 'tests/fixtures/v1/package.json': pkg('2.0.0') });
    expect(detect(fixture).filter((i) => i.check === 'version-mismatch')).toEqual([]);
  });

  test('a package is its exact name: other scopes, the unscoped name and an underscore spelling are other packages', () => {
    const pkg = (name, version) => `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`;
    const root = repo(
      { 'a/package.json': pkg('@one/kit', '1.0.0'), 'b/package.json': pkg('@two/kit', '1.0.0'), '.claude-plugin/plugin.json': pkg('kit', '1.0.0'), 'c/package.json': pkg('foo-bar', '1.0.0'), 'd/package.json': pkg('foo_bar', '1.0.0'), 'README.md': '# kits\n' },
      { 'a/package.json': pkg('@one/kit', '1.1.0'), 'c/package.json': pkg('foo-bar', '1.1.0'), 'README.md': '# kits\n\nnpm i foo_bar@1.0.0\nnpm i kit@1.0.0\n' },
    );
    expect(detect(root).filter((i) => i.check === 'version-mismatch')).toEqual([]);
  });

  test('versioned and archived docs and manifests keep old commands and versions', () => {
    const pkg = (version) => `{\n  "name": "kit",\n  "version": "${version}"\n}\n`;
    const lines = 'Run `/old-scan` first.\n\nnpm i kit@1.0.0\n';
    const docs = repo(
      { 'package.json': pkg('1.1.0'), 'commands/old-scan.md': '# old\n', 'versioned_docs/v1.0/usage.md': lines, 'docs/archive/2024/usage.md': lines },
      { 'commands/old-scan.md': null, 'versioned_docs/v1.1/usage.md': lines, 'docs/usage.md': lines },
    );
    const items = detect(docs).filter((i) => ['doc-example-stale', 'version-mismatch'].includes(i.check));
    expect(items.map((i) => `${i.check}@${i.file}:${i.line}`).sort()).toEqual(['doc-example-stale@docs/usage.md:1', 'version-mismatch@docs/usage.md:3']);
    const log = repo({ 'CHANGELOG.md': changelog, 'src/a.js': 'x\n' }, { 'versioned_docs/v1.0/commands/old.md': '# old\n' });
    expect(detect(log).filter((i) => i.check === 'changelog-missing')).toEqual([]);
    const manifests = repo(
      { 'package.json': pkg('1.0.0'), 'archive/v1/package.json': pkg('1.0.0'), '.claude-plugin/plugin.json': pkg('1.0.0') },
      { 'package.json': pkg('1.1.0') },
    );
    expect(detect(manifests).filter((i) => i.check === 'version-mismatch').map((i) => i.file)).toEqual(['.claude-plugin/plugin.json']);
  });

  test('a new install line pins an old version of our package; the current one and other packages pass', () => {
    const root = repo(
      { 'package.json': '{\n  "name": "kit",\n  "version": "2.0.0"\n}\n', 'README.md': '# kit\n' },
      { 'README.md': '# kit\n\nnpm i kit@1.9.0\nnpm i kit@2.0.0\nnpm i lodash@1.9.0\n' },
    );
    const items = detect(root).filter((i) => i.check === 'version-mismatch');
    expect(items.map((i) => `${i.line}:${i.severity}`)).toEqual(['3:review']);
  });
});

// A function of 12 lines and 60-odd tokens: long enough to count as a copy when repeated.
const block = (name, label) => [
  `function ${name}(items, options) {`,
  '  const seen = new Set();',
  '  const out = [];',
  '  for (const item of items) {',
  '    if (seen.has(item.id)) continue;',
  '    seen.add(item.id);',
  `    const score = item.weight * options.scale + options.offset;`,
  `    if (score < options.floor) { log("${label} below floor", item.id); continue; }`,
  '    out.push({ id: item.id, score, tags: item.tags.filter(Boolean) });',
  '  }',
  '  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));',
  '  return out.slice(0, options.limit);',
  '}',
].join('\n');

describe('code shape', () => {

  test('added code that repeats existing code names the other place; a table of same-shaped rows and test code do not', () => {
    const root = repo(
      { 'src/rank.js': `${block('rankItems', 'rank')}\nmodule.exports = { rankItems };\n` },
      {
        'src/score.js': `${block('scoreItems', 'score')}\nmodule.exports = { scoreItems };\n`,
        'src/table.js': Array.from({ length: 14 }, (_, i) => `register("name${i}", handler, ${i}, { retries: 2, timeout: 30 });`).join('\n') + '\n',
        'tests/rank.test.js': `${block('rankAgain', 'test')}\n`,
      },
    );
    const items = detect(root).filter((i) => i.check === 'duplicate-code');
    expect(items.map((i) => i.file)).toEqual(['src/score.js']);
    expect(items[0].message).toContain('lines 2-13 repeat src/rank.js:2-13');
  });

  test('candidate files over the size limit are never read, and a copy in a small file is still found', () => {
    // In process, to see which blobs the duplicate check loads; the other checks are off so their
    // own reads do not count.
    const { BlobReader } = require('../detector/git');
    const { detect: detectIn, CHECKS } = require('../detector');
    const big = `${block('rankBig', 'big')}\n` + '// a long file the scan must not load\n'.repeat(30000);
    const root = repo(
      { 'src/rank.js': `${block('rankItems', 'rank')}\nmodule.exports = { rankItems };\n`, 'src/big1.js': big, 'src/big2.js': big },
      { 'src/score.js': `${block('scoreItems', 'score')}\nmodule.exports = { scoreItems };\n` },
    );
    const loaded = new Set();
    const read = BlobReader.prototype.read;
    const readMany = BlobReader.prototype.readMany;
    const spies = [
      jest.spyOn(BlobReader.prototype, 'read').mockImplementation(function (p) { loaded.add(p); return read.call(this, p); }),
      jest.spyOn(BlobReader.prototype, 'readMany').mockImplementation(function (ps) { for (const p of ps) loaded.add(p); return readMany.call(this, ps); }),
    ];
    try {
      const r = detectIn(root, { scope: 'diff', base: 'main', paths: [], disable: CHECKS.map((c) => c.id).filter((id) => id !== 'duplicates') });
      expect(r.items.map((i) => `${i.file}:${i.token}`)).toEqual(['src/score.js:src/rank.js:2']);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(loaded.has('src/rank.js')).toBe(true);
    expect(loaded.has('src/big1.js') || loaded.has('src/big2.js')).toBe(false);
  });

  test('the same block added twice in one change is reported once, on the later copy', () => {
    const root = repo({ 'README.md': 'x\n' }, { 'src/a.js': `${block('first', 'a')}\n`, 'src/b.js': `${block('second', 'b')}\n` });
    const items = detect(root).filter((i) => i.check === 'duplicate-code');
    expect(items.map((i) => `${i.file}:${i.token}`)).toEqual(['src/b.js:src/a.js:2']);
  });
});

// Stand-in tools that answer --version and then run `script`, so the mapping onto the change is
// tested without the real linters.
function fakeTool(dir, name, script) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${name} 0.0.0"; exit 0; fi\n${script}\n`, { mode: 0o755 });
}
// node for the detector, the system tools the stand-ins use, and none of the real linters.
const basePath = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
function detectWith(root, PATH, ...args) {
  const r = spawnSync('node', [DETECT, root, '--base=main', '--json', ...args], { encoding: 'utf8', env: { ...process.env, PATH } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

describe('complexity', () => {
  test('ruff diagnostics on lines the change added are reported; one on a line it did not write is not', () => {
    const root = repo(
      { 'src/old.py': 'def legacy(a, b, c, d, e, f):\n    return a\n' },
      { 'src/old.py': 'def legacy(a, b, c, d, e, f):\n    return a + 1\n', 'src/new.py': 'def build(a, b, c, d, e, f):\n    return a\n', 'tests/test_new.py': 'def test_x(a, b, c, d, e, f):\n    pass\n' },
    );
    const bin = path.join(root + '-tools', 'bin');
    roots.push(root + '-tools');
    // Only the complexity rules get an answer; the lint check's own ruff call sees a clean file.
    fakeTool(bin, 'ruff', `cat >/dev/null\ncase "$*" in *C901*) echo '[{"code":"PLR0913","message":"Too many arguments in function definition (6 > 5)","location":{"row":1}}]';; *) echo '[]';; esac\nexit 1`);
    const r = detectWith(root, `${bin}${path.delimiter}${basePath}`);
    const items = r.items.filter((i) => i.check === 'complexity');
    expect(items.map((i) => `${i.file}:${i.line}`)).toEqual(['src/new.py:1']);
    expect(items[0].message).toContain('ruff PLR0913: Too many arguments in function definition (6 > 5)');
    expect(r.skipped).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('eslint, golangci-lint and clippy diagnostics map onto the files and lines the change added', () => {
    const root = repo(
      { 'eslint.config.js': 'module.exports = [];\n', 'go.mod': 'module example.com/t\n', 'Cargo.toml': '[workspace]\nmembers = ["crates/k"]\n', 'crates/k/Cargo.toml': '[package]\nname = "k"\n', 'src/old.ts': 'export function old(a: number) {\n  return a\n}\n' },
      { 'src/old.ts': 'export function old(a: number) {\n  return a + 1\n}\n', 'src/app.ts': 'export function load(a, b, c, d, e, f) {\n  return a\n}\n', 'src/g.go': 'package src\n\nfunc Deep(x int) int {\n\treturn x\n}\n', 'crates/k/src/lib.rs': 'pub fn tangled() {\n    let x = 1;\n}\n' },
    );
    const bin = path.join(root + '-tools', 'bin');
    roots.push(root + '-tools');
    // The repository's own eslint, as an install puts it in node_modules/.bin.
    fakeTool(path.join(root, 'node_modules', '.bin'), 'eslint', `cat <<EOF\n[{"filePath":"$PWD/src/app.ts","messages":[{"ruleId":"max-params","line":1,"message":"Function 'load' has too many parameters (6). Maximum allowed is 5."},{"ruleId":"no-unused-vars","line":2,"message":"unused"}]},{"filePath":"$PWD/src/old.ts","messages":[{"ruleId":"complexity","line":1,"message":"Function 'old' has a complexity of 11."}]}]\nEOF\nexit 1`);
    fakeTool(bin, 'golangci-lint', `echo '{"Issues":[{"FromLinter":"nestif","Text":"\`if x\` has complex nested blocks (complexity: 6)","Pos":{"Filename":"src/g.go","Line":3}}]}'\nexit 1`);
    fakeTool(bin, 'cargo', `case "$1" in\n  locate-project) echo "$PWD/Cargo.toml";;\n  clippy) echo '{"reason":"compiler-artifact"}'; echo '{"reason":"compiler-message","message":{"code":{"code":"clippy::cognitive_complexity"},"message":"the function has a cognitive complexity of (30/25)","spans":[{"is_primary":true,"file_name":"crates/k/src/lib.rs","line_start":1}]}}';;\n  *) exit 2;;\nesac`);
    const r = detectWith(root, `${bin}${path.delimiter}${basePath}`);
    expect(r.items.filter((i) => i.check === 'complexity').map((i) => `${i.file}:${i.line}:${i.token}`).sort()).toEqual(['crates/k/src/lib.rs:1:cognitive_complexity', 'src/app.ts:1:max-params', 'src/g.go:3:nestif']);
    expect(r.skipped).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('a language whose linter is missing is named as skipped; a linter that crashes is a detector error', () => {
    const root = repo(
      { 'README.md': 'x\n' },
      { 'src/a.py': 'def a():\n    pass\n', 'src/b.go': 'package src\n', 'src/c.rs': 'fn c() {}\n', 'src/d.ts': 'export const d = 1\n' },
    );
    const missing = detectWith(root, basePath);
    expect(missing.skipped).toEqual([
      'complexity: Python not measured (ruff is not installed)',
      'complexity: JavaScript/TypeScript not measured (the repository has no eslint config)',
      'complexity: Go not measured (golangci-lint is not installed)',
      'complexity: Rust not measured (cargo is not installed)',
    ]);
    const bin = path.join(root + '-tools', 'bin');
    roots.push(root + '-tools');
    fakeTool(bin, 'ruff', 'cat >/dev/null\necho "ruff: crashed" >&2\nexit 2');
    const crashed = detectWith(root, `${bin}${path.delimiter}${basePath}`);
    expect(crashed.errors).toContain('complexity: ruff failed (exit 2): ruff: crashed');
  });
});

describe('agent config', () => {
  const skill = '---\nname: Bad Name\ndescription: does things\n---\n\nBody.\n';
  // A stand-in agnix that reports fixed diagnostics, so the mapping is tested without the real tool.
  function fakeAgnix(dir) {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const out = JSON.stringify({ diagnostics: [
      { level: 'error', rule: 'AS-004', file: 'skills/x/SKILL.md', line: 2, message: 'bad name', rule_severity: 'HIGH' },
      { level: 'warning', rule: 'PE-004', file: 'skills/x/SKILL.md', line: 3, message: 'ambiguous term', rule_severity: 'MEDIUM' },
      { level: 'error', rule: 'CC-MEM-001', file: 'AGENTS.md', line: 1, message: 'old problem', rule_severity: 'HIGH' },
    ] });
    fs.writeFileSync(path.join(bin, 'agnix'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "agnix 0.0.0"; exit 0; fi\ncat <<'EOF'\n${out}\nEOF\nexit 1\n`, { mode: 0o755 });
    return bin;
  }

  test('agnix errors on changed agent files map to findings, MEDIUM warnings do not; without agnix the check is silent', () => {
    const root = repo({ 'AGENTS.md': '# Rules\n\n- one\n' }, { 'skills/x/SKILL.md': skill, 'AGENTS.md': '# Rules\n\n- one\n- two\n' });
    const bin = fakeAgnix(root + '-tools');
    roots.push(root + '-tools');
    const run = (PATH) => {
      const r = spawnSync('node', [DETECT, root, '--base=main', '--json'], { encoding: 'utf8', env: { ...process.env, PATH } });
      expect(r.status).toBe(0);
      return JSON.parse(r.stdout);
    };
    const items = run(`${bin}${path.delimiter}${basePath}`).items.filter((i) => i.check === 'agent-config');
    expect(items.map((i) => `${i.file}:${i.line}:${i.severity}:${i.token}`).sort()).toEqual(['AGENTS.md:1:review:CC-MEM-001', 'skills/x/SKILL.md:2:high:AS-004']);
    const without = run(basePath);
    expect(without.items.filter((i) => i.check === 'agent-config')).toEqual([]);
    expect(without.errors).toEqual([]);
  });
});

// The detector's JSON piped into the confirm step, as the skill runs them.
describe('detector to confirm', () => {
  const CONFIRM = path.join(__dirname, '..', 'scripts', 'confirm.js');
  // A stand-in model that dismisses every finding it was shown and counts them.
  function dismissAll(dir) {
    const p = path.join(dir, 'dismiss.js');
    fs.writeFileSync(p, `const prompt = require('fs').readFileSync(0, 'utf8');
const ids = [...prompt.matchAll(/^\\[(\\d+)\\] /gm)].map((m) => Number(m[1]));
process.stdout.write(JSON.stringify({ confirmed: [], dismissed: ids.map((id) => ({ id, why: 'example' })), fixes: [] }));
`);
    return JSON.stringify(['node', p]);
  }
  function pipe(root, detectArgs, env = {}) {
    const d = spawnSync('node', [DETECT, root, '--base=main', '--json', ...detectArgs], { encoding: 'utf8', env: { ...process.env, ...env } });
    expect(d.status).toBe(0);
    const c = spawnSync('node', [CONFIRM, `--repo=${root}`, `--cmd=${dismissAll(root + '-tools')}`], { input: d.stdout, encoding: 'utf8' });
    return { detected: JSON.parse(d.stdout), confirm: c };
  }

  test('every finding past the text cap of 40 is judged, and input cut short with --max is refused', () => {
    const docs = {};
    for (let i = 0; i < 15; i++) docs[`docs/p${i}.md`] = [0, 1, 2].map((k) => `See src/gone${i}x${k}.js for part ${k}.`).join('\n') + '\n';
    const root = repo({ 'src/a.js': 'x\n', 'docs/p0.md': '# d\n' }, docs);
    fs.mkdirSync(root + '-tools');
    roots.push(root + '-tools');
    const { detected, confirm } = pipe(root, []);
    expect(detected.total).toBe(45);
    expect(detected.items.length).toBe(45);
    const out = JSON.parse(confirm.stdout);
    expect(out.summary).toMatchObject({ reported: 45, confirmed: 0, dismissed: 45 });
    const cut = pipe(root, ['--max=40']).confirm;
    expect(cut.status).toBe(1);
    expect(cut.stderr).toMatch(/holds 40 of the detector's 45 findings/);
  });

  test('a duplicate search that fails is a detector error, not a clean result', () => {
    const root = repo({ 'src/rank.js': `${block('rankItems', 'rank')}\nmodule.exports = { rankItems };\n` }, { 'src/score.js': `${block('scoreItems', 'score')}\nmodule.exports = { scoreItems };\n` });
    fs.mkdirSync(root + '-tools');
    roots.push(root + '-tools');
    // A git whose file search (git grep -l) fails, as a timeout or a broken index would.
    const bin = path.join(root + '-tools', 'bin');
    fs.mkdirSync(bin);
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-l" ] && { echo "fatal: simulated failure" >&2; exit 2; }; done\nexec ${realGit} "$@"\n`, { mode: 0o755 });
    const ok = pipe(root, [], { DESLOP_NO_RG: '1' });
    expect(ok.detected.items.map((i) => `${i.check}@${i.file}`)).toContain('duplicate-code@src/score.js');
    expect(ok.detected.errors).toEqual([]);
    const r = pipe(root, [], { DESLOP_NO_RG: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    expect(r.detected.errors).toEqual(['duplicates: git grep failed (exit 2): fatal: simulated failure']);
    expect(JSON.parse(r.confirm.stdout).detectorErrors).toEqual(r.detected.errors);
  });

  test('a ripgrep search that cannot read a file is a detector error, not a clean result', () => {
    // Without rg the git grep path runs, which the test above covers; root reads any file.
    if (spawnSync('rg', ['--version']).status !== 0 || process.getuid?.() === 0) return;
    const root = repo({ 'src/rank.js': `${block('rankItems', 'rank')}\nmodule.exports = { rankItems };\n` }, { 'src/score.js': `${block('scoreItems', 'score')}\nmodule.exports = { scoreItems };\n` });
    fs.mkdirSync(root + '-tools');
    roots.push(root + '-tools');
    // rg exits 2 when it could not read a file; the matches it did print are an incomplete answer.
    fs.chmodSync(path.join(root, 'src/rank.js'), 0o000);
    try {
      const r = pipe(root, []);
      expect(r.detected.errors).toContainEqual(expect.stringMatching(/^duplicates: rg failed \(exit 2\): .*Permission denied/));
      expect(JSON.parse(r.confirm.stdout).detectorErrors).toEqual(r.detected.errors);
    } finally {
      fs.chmodSync(path.join(root, 'src/rank.js'), 0o644);
    }
  });

  test('a blob-size query that fails is a detector error, not a set of missing files', () => {
    const root = repo({ 'src/rank.js': `${block('rankItems', 'rank')}\nmodule.exports = { rankItems };\n` }, { 'src/score.js': `${block('scoreItems', 'score')}\nmodule.exports = { scoreItems };\n` });
    fs.mkdirSync(root + '-tools');
    roots.push(root + '-tools');
    const bin = path.join(root + '-tools', 'bin');
    fs.mkdirSync(bin);
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do case "$a" in --batch-check*) echo "fatal: simulated failure" >&2; exit 2;; esac; done\nexec ${realGit} "$@"\n`, { mode: 0o755 });
    const r = pipe(root, [], { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    expect(r.detected.errors).toEqual(['duplicates: git cat-file failed (exit 2): fatal: simulated failure']);
    expect(JSON.parse(r.confirm.stdout).detectorErrors).toEqual(r.detected.errors);
  });

  test('a check that failed reaches the result, with and without findings', () => {
    // agnix that crashes: the agent-config check cannot run, which must not read as clean.
    const tools = fs.mkdtempSync(path.join(TMP, 'deslop-tools-'));
    roots.push(tools);
    const bin = path.join(tools, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'agnix'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "agnix 0.0.0"; exit 0; fi\necho "panicked at src/main.rs" >&2\nexit 101\n', { mode: 0o755 });
    const PATH = `${bin}${path.delimiter}${process.env.PATH}`;
    const quiet = repo({ 'AGENTS.md': '# Rules\n' }, { 'AGENTS.md': '# Rules\n\n- one\n' });
    fs.mkdirSync(quiet + '-tools');
    roots.push(quiet + '-tools');
    let r = pipe(quiet, [], { PATH });
    expect(r.detected.errors).toEqual(['agentconfig: agnix failed (exit 101): panicked at src/main.rs']);
    let out = JSON.parse(r.confirm.stdout);
    expect(out.findings).toEqual([]);
    expect(out.detectorErrors).toEqual(r.detected.errors);
    const noisy = repo({ 'AGENTS.md': '# Rules\n', 'src/a.js': 'x\n' }, { 'AGENTS.md': '# Rules\n\n- one\n', 'docs/a.md': 'See src/gone.js.\n' });
    fs.mkdirSync(noisy + '-tools');
    roots.push(noisy + '-tools');
    r = pipe(noisy, [], { PATH });
    out = JSON.parse(r.confirm.stdout);
    expect(out.summary.dismissed).toBe(1);
    expect(out.detectorErrors).toEqual(r.detected.errors);
  });
});

describe('files', () => {
  test('JSONC config is not a broken file; invalid JSON is', () => {
    const root = repo({ 'README.md': 'x\n' }, { '.devcontainer/devcontainer.json': '{\n  // image\n  "image": "x",\n}\n', 'tsconfig.json': '{ /* strict */ "compilerOptions": {} }\n', 'config/app.json': '{"a": }\n', 'package.json': '{"name": "x",}\n' });
    const broken = detect(root).filter((i) => i.check === 'broken-file').map((i) => i.file).sort();
    expect(broken).toEqual(['config/app.json', 'package.json']);
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

  test('--worktree covers files not yet added to git', () => {
    const root = repo({ 'README.md': '# x\n' }, { 'README.md': '# x\n\nSee tools/new.sh.\n' }, { commit: false });
    write(root, { 'tools/new.sh': '#!/bin/sh\n# per review: keep\necho hi\n' });
    const items = detect(root, '--worktree');
    expect(items.some((i) => i.check === 'missing-path')).toBe(false);
    expect(items.some((i) => i.check === 'review-provenance' && i.file === 'tools/new.sh')).toBe(true);
  });

  test('--worktree without ripgrep still sees calls inside untracked files', () => {
    const root = repo({ 'README.md': '# x\n' }, {}, { commit: false });
    write(root, { 'tools/calc.py': 'def compute_result():\n    return 1\n\nprint(compute_result())\n' });
    const r = spawnSync('node', [DETECT, root, '--base=main', '--json', '--worktree'], { encoding: 'utf8', env: { ...process.env, DESLOP_NO_RG: '1' } });
    expect(JSON.parse(r.stdout).items.filter((i) => i.check === 'no-caller' && i.message.includes('compute_result'))).toEqual([]);
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

  test('a subdirectory given as the repo runs from the top level', () => {
    const root = repo({ 'pkg/docs/a.md': '# a\n', 'pkg/src/a.js': '1\n' }, { 'pkg/docs/a.md': '# a\n\nSee [a](../src/a.js).\n' });
    const r = spawnSync('node', [DETECT, path.join(root, 'pkg'), '--base=main', '--json'], { encoding: 'utf8' });
    expect(JSON.parse(r.stdout).items.filter((i) => i.check === 'missing-path')).toEqual([]);
  });

  test('not a git repository is an error with exit 1', () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'deslop-nogit-'));
    roots.push(dir);
    const r = spawnSync('node', [DETECT, dir], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a git repository');
  });
});
