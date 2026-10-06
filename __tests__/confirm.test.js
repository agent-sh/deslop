'use strict';
// The confirm step: a stand-in model command replies, and the result must hold only what the
// reply and the files support. No real model is called.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIRM = path.join(__dirname, '..', 'scripts', 'confirm.js');
const DETECT = path.join(__dirname, '..', 'scripts', 'detect.js');
const TMP = process.env.DESLOP_TEST_TMP || os.tmpdir();
const dirs = [];

function workspace(files) {
  const root = fs.mkdtempSync(path.join(TMP, 'deslop-confirm-'));
  dirs.push(root);
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), content);
  }
  return root;
}

const report = {
  scope: 'diff',
  base: 'main (abc)',
  total: 2,
  items: [
    { check: 'stale-mention', severity: 'high', file: 'docs/setup.md', line: 2, excerpt: 'Run scripts/old.sh first.', message: '`scripts/old.sh` was deleted by this change, but this line still says it', token: 'scripts/old.sh' },
    { check: 'missing-path', severity: 'review', file: 'docs/setup.md', line: 3, excerpt: 'See path/to/example.js', message: 'cites `path/to/example.js`, which does not exist in this repo' },
  ],
};
const files = { 'docs/setup.md': '# Setup\nRun scripts/old.sh first.\nSee path/to/example.js\n' };

// A model stand-in: prints the reply given in REPLY, after checking the prompt it got (its
// argument when given one, else stdin). Returns the command as the JSON array --cmd takes.
function fakeModel(root) {
  const p = path.join(root, 'model.js');
  fs.writeFileSync(p, `const fs = require('fs');
const prompt = process.argv.length > 2 ? process.argv[2] : fs.readFileSync(0, 'utf8');
if (!prompt.includes('[1] stale-mention (high) docs/setup.md:2') || !prompt.includes('>     2 | Run scripts/old.sh first.')) { console.error('bad prompt'); process.exit(3); }
if (process.env.NOT_IN_PROMPT && prompt.includes(process.env.NOT_IN_PROMPT)) { console.error('prompt holds text from outside the repo'); process.exit(4); }
process.stdout.write(process.env.REPLY);
`);
  return JSON.stringify(['node', p]);
}

function confirm(root, reply, args = [], env = {}, rep = report) {
  const input = path.join(root, 'report.json');
  fs.writeFileSync(input, JSON.stringify(rep));
  const clean = { ...process.env, ...env, REPLY: reply };
  if (!('DESLOP_SMALL_CMD' in env)) delete clean.DESLOP_SMALL_CMD;
  if (!('GISHRA_STATE' in env)) delete clean.GISHRA_STATE;
  const r = spawnSync('node', [CONFIRM, `--input=${input}`, `--repo=${root}`, ...args], { encoding: 'utf8', env: clean });
  return r;
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('a valid reply confirms, dismisses and keeps only fixes that match the file', () => {
  const root = workspace(files);
  const reply = 'Here you go:\n```json\n' + JSON.stringify({
    confirmed: [1],
    dismissed: [{ id: 2, why: 'placeholder path in an example' }],
    fixes: [
      { file: 'docs/setup.md', line: 2, action: 'replace', old: 'scripts/old.sh', new: 'scripts/install.sh', reason: 'stale-mention' },
      { file: 'docs/setup.md', line: 2, action: 'replace', old: 'not on the line', new: 'x' },
      { file: 'docs/setup.md', line: 1, action: 'remove-line' },
    ],
  }) + '\n```\n';
  const r = confirm(root, reply, [`--cmd=${fakeModel(root)}`]);
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.error).toBeUndefined();
  expect(out.findings.map((f) => `${f.check}@${f.file}:${f.line}`)).toEqual(['stale-mention@docs/setup.md:2']);
  expect(out.dismissed.map((d) => d.why)).toEqual(['placeholder path in an example']);
  expect(out.fixes).toEqual([{ file: 'docs/setup.md', line: 2, action: 'replace', old: 'scripts/old.sh', new: 'scripts/install.sh', reason: 'stale-mention' }]);
  expect(out.rejectedFixes.map((x) => x.why).sort()).toEqual(['"old" is not on that line', 'not the line of a confirmed finding']);
  expect(out.summary).toMatchObject({ reported: 2, confirmed: 1, dismissed: 1, fixable: 1 });
});

test('an invalid reply returns every finding unconfirmed with the reason', () => {
  const root = workspace(files);
  for (const reply of ['Both look real to me.', JSON.stringify({ confirmed: [1, 7], dismissed: [], fixes: [] }), JSON.stringify({ confirmed: [1], dismissed: [{ id: 1, why: 'x' }], fixes: [] }), JSON.stringify({ confirmed: [1], dismissed: [] })]) {
    const out = JSON.parse(confirm(root, reply, [`--cmd=${fakeModel(root)}`]).stdout);
    expect(out.error).toBeTruthy();
    expect(out.findings).toEqual([]);
    expect(out.fixes).toEqual([]);
    expect(out.unconfirmed.map((u) => u.id)).toEqual([1, 2]);
  }
});

test('a reply that leaves a finding unjudged is not trusted', () => {
  const root = workspace(files);
  for (const reply of [{ confirmed: [], dismissed: [], fixes: [] }, { confirmed: [1], dismissed: [], fixes: [] }, { confirmed: [], dismissed: [{ id: 2, why: 'example' }], fixes: [] }]) {
    const out = JSON.parse(confirm(root, JSON.stringify(reply), [`--cmd=${fakeModel(root)}`]).stdout);
    expect(out.error).toMatch(/does not judge finding/);
    expect(out.findings).toEqual([]);
    expect(out.dismissed).toEqual([]);
    expect(out.unconfirmed.map((u) => u.id)).toEqual([1, 2]);
  }
});

test('a file outside the repository, directly or through a tracked symlink, is neither shown to the model nor fixed', () => {
  const outside = fs.mkdtempSync(path.join(TMP, 'deslop-outside-'));
  dirs.push(outside);
  const secret = 'SENTINEL-OUTSIDE-THE-REPO';
  fs.writeFileSync(path.join(outside, 'secret.txt'), `${secret}\n`);
  const root = workspace(files);
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'docs', 'key.md'));
  fs.symlinkSync(outside, path.join(root, 'linked'));
  const escape = path.relative(root, path.join(outside, 'secret.txt'));
  const rep = { scope: 'diff', items: [
    report.items[0],
    { check: 'local-path', severity: 'high', file: 'docs/key.md', line: 1, excerpt: path.join(outside, 'secret.txt'), message: 'points at a machine-local path' },
    { check: 'local-path', severity: 'high', file: 'linked/secret.txt', line: 1, excerpt: 'x', message: 'points at a machine-local path' },
    { check: 'local-path', severity: 'high', file: escape, line: 1, excerpt: 'x', message: 'points at a machine-local path' },
  ] };
  const fix = (file) => ({ file, line: file === 'docs/setup.md' ? 2 : 1, action: 'replace', old: file === 'docs/setup.md' ? 'scripts/old.sh' : secret, new: 'gone' });
  const reply = { confirmed: [1, 2, 3, 4], dismissed: [], fixes: ['docs/setup.md', 'docs/key.md', 'linked/secret.txt', escape].map(fix) };
  const r = confirm(root, JSON.stringify(reply), [`--cmd=${fakeModel(root)}`], { NOT_IN_PROMPT: secret }, rep);
  const out = JSON.parse(r.stdout);
  expect(out.error).toBeUndefined();
  expect(out.findings.map((f) => f.id)).toEqual([1, 2, 3, 4]);
  expect(out.fixes.map((f) => f.file)).toEqual(['docs/setup.md']);
  expect(out.rejectedFixes.map((x) => `${x.fix.file}: ${x.why}`)).toEqual(['docs/key.md', 'linked/secret.txt', escape].map((f) => `${f}: not a file inside the repository (outside it or through a symlink)`));
});

test('with no model configured the findings are printed for the caller to judge', () => {
  const root = workspace(files);
  const r = confirm(root, '');
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^deslop-confirm: no small model configured/);
  expect(r.stdout).toContain('[2] missing-path (review) docs/setup.md:3');
  expect(r.stdout).toContain('>     3 | See path/to/example.js');
});

test.each(['tracked', 'untracked'])('the detector-to-model pipeline never discloses a %s outside symlink', (tracking) => {
  const root = workspace({ ...files, 'scripts/old.sh': '#!/bin/sh\n' });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  fs.unlinkSync(path.join(root, 'scripts/old.sh'));
  const secret = 'REVKEY42';
  const outside = workspace({ 'key.json': `{"${secret}": }\n`, 'key.md': `${secret} repeated prose\n${secret} repeated prose\n` });
  const file = tracking === 'tracked' ? 'config/key.json' : 'docs/key.md';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.symlinkSync(path.join(outside, path.basename(file)), path.join(root, file));
  if (tracking === 'tracked') git('add', file);
  // A real local finding ensures confirmation actually invokes the stand-in model.
  fs.writeFileSync(path.join(root, 'docs/local.md'), 'Local repeated prose\nLocal repeated prose\n');
  const detected = spawnSync('node', [DETECT, root, '--base=main', '--worktree', '--json'], { encoding: 'utf8' });
  expect(detected.status).toBe(0);
  const rep = JSON.parse(detected.stdout);
  const model = argvModel(root);
  const r = confirm(root, '', [`--cmd=${JSON.stringify(['node', model])}`], { NOT_IN_PROMPT: secret }, rep);
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.error).toBeUndefined();
  expect(out.summary.confirmed).toBeGreaterThan(0);
  expect(rep.items).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'duplicate-line', file: 'docs/local.md' })]));
  expect(detected.stdout).not.toContain(secret);
});

test.each(['fallback', 'empty', 'model', 'failed-model', 'dry-run', 'dry-run-no-model', 'invalid-config'])('coverage notices survive the %s output path', (mode) => {
  const root = workspace(files);
  const rep = {
    ...report,
    errors: ['duplicates: git grep failed'],
    skipped: ['complexity: JavaScript/TypeScript not measured (the repository has no eslint config)'],
  };
  if (mode === 'empty') { rep.items = []; rep.total = 0; }
  const args = [];
  if (['model', 'failed-model', 'dry-run'].includes(mode)) args.push(`--cmd=${fakeModel(root)}`);
  if (mode.startsWith('dry-run')) args.push('--dry-run');
  const env = {};
  if (mode === 'invalid-config') {
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ harness: 'codex', ladder: { small: {} } }));
    env.GISHRA_STATE = state;
  }
  const reply = mode === 'failed-model' ? 'invalid reply' : JSON.stringify({ confirmed: [1, 2], dismissed: [], fixes: [] });
  const r = confirm(root, reply, args, env, rep);
  expect(r.status).toBe(mode === 'invalid-config' ? 1 : 0);
  if (mode === 'fallback') {
    expect(r.stdout).toContain('put these in "detectorErrors"');
    expect(r.stdout).toContain('put these in "skipped"');
    expect(r.stdout).toContain(rep.errors[0]);
    expect(r.stdout).toContain(rep.skipped[0]);
  } else {
    const out = JSON.parse(r.stdout);
    expect(out.detectorErrors).toEqual(rep.errors);
    expect(out.skipped).toEqual(rep.skipped);
  }
});

test('the Tower Crane small rung runs a command harness with the prompt substituted', () => {
  const root = workspace(files);
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const model = JSON.parse(fakeModel(root));
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, ladder: { small: { harness: 'command', command: [...model, '{prompt}'] } } }));
  const out = JSON.parse(confirm(root, JSON.stringify({ confirmed: [1, 2], dismissed: [], fixes: [] }), [], { GISHRA_STATE: state }).stdout);
  expect(out.error).toBeUndefined();
  expect(out.model).toBe('command');
  expect(out.findings.map((f) => f.id)).toEqual([1, 2]);
});

describe('harness command shapes', () => {
  const shapes = [
    [{ harness: 'codex', profile: 'luna', effort: 'low' }, ['codex', 'exec', '-p', 'luna', '-c', 'model_reasoning_effort=low', 'PROMPT']],
    [{ harness: 'codex', model: 'gpt-x' }, ['codex', 'exec', '-m', 'gpt-x', 'PROMPT']],
    [{ harness: 'claude', model: 'claude-x' }, ['claude', '-p', 'PROMPT', '--model', 'claude-x']],
    [{ harness: 'opencode', model: 'prov/m' }, ['opencode', 'run', 'PROMPT', '-m', 'prov/m']],
    [{ harness: 'agy', model: 'agy-m', effort: 'high', args: ['--print-timeout', '0'] }, ['agy', '-p', 'PROMPT', '--model', 'agy-m', '--effort', 'high', '--print-timeout', '0']],
    [{ harness: 'pi', model: 'pi-m', provider: 'openai', effort: 'medium' }, ['pi', '-p', 'PROMPT', '--model', 'pi-m', '--provider', 'openai', '--thinking', 'medium']],
  ];
  test.each(shapes)('%j', (role, expected) => {
    const root = workspace(files);
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, ladder: { small: role } }));
    const r = confirm(root, '', ['--dry-run'], { GISHRA_STATE: state });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    const argv = out.argv.map((a) => (a.startsWith('You are confirming findings from deslop') ? 'PROMPT' : a));
    expect(argv).toEqual(expected);
    expect(out.stdin).toBe(false);
  });
});

// A model stand-in that takes the prompt as its only argument or, with none, from stdin, and
// confirms every finding it was shown. It exits non-zero when the prompt arrived split, altered
// or oversized, which confirm.js turns into an "error".
function argvModel(root) {
  const p = path.join(root, 'argv-model.js');
  fs.writeFileSync(p, `const fs = require('fs');
const args = process.argv.slice(2);
if (args.length > 1) { console.error('expected one argument, got ' + args.length); process.exit(3); }
const prompt = args.length ? args[0] : fs.readFileSync(0, 'utf8');
if (!prompt.startsWith('You are confirming findings from deslop')) { console.error('not the prompt: ' + prompt.slice(0, 80)); process.exit(5); }
if (process.env.EXPECT_LINE && !prompt.includes(process.env.EXPECT_LINE)) { console.error('context line altered'); process.exit(6); }
if (process.env.NOT_IN_PROMPT && prompt.includes(process.env.NOT_IN_PROMPT)) { console.error('prompt holds text from outside the repo'); process.exit(4); }
if (Buffer.byteLength(prompt) > 96 * 1024) { console.error('prompt over 96 KiB'); process.exit(7); }
if (process.env.CALLS) fs.appendFileSync(process.env.CALLS, Buffer.byteLength(prompt) + '\\n');
const ids = [...prompt.matchAll(/^\\[(\\d+)\\] /gm)].map((m) => Number(m[1]));
process.stdout.write(JSON.stringify({ confirmed: ids, dismissed: [], fixes: [] }));
`);
  return p;
}

describe('the model command is an argv array', () => {
  // Quotes, a command substitution, backticks and a backslash: anything that re-parsed the
  // prompt would split it, drop characters or run the commands.
  const hostile = `Run "$(touch PWNED1)" and 'single' \`touch PWNED2\` back\\slash $HOME * # don't`;
  const hostileFiles = { 'docs/setup.md': `# Setup\n${hostile}\nSee path/to/example.js\n` };

  test.each([
    ['--cmd, prompt as an element', (m) => [`--cmd=${JSON.stringify(['node', m, '{prompt}'])}`], {}],
    ['--cmd, prompt on stdin', (m) => [`--cmd=${JSON.stringify(['node', m])}`], {}],
    ['DESLOP_SMALL_CMD', () => [], { DESLOP_SMALL_CMD: '%CMD%' }],
  ])('%s', (_, args, env) => {
    const root = workspace(hostileFiles);
    const m = argvModel(root);
    const e = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace('%CMD%', JSON.stringify(['node', m, '{prompt}']))]));
    const r = confirm(root, '', args(m), { ...e, EXPECT_LINE: hostile });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBeUndefined();
    expect(out.findings.map((f) => f.id)).toEqual([1, 2]);
    expect(fs.existsSync(path.join(root, 'PWNED1')) || fs.existsSync(path.join(root, 'PWNED2'))).toBe(false);
  });

  test.each([
    ['a shell string', (m) => `node ${m} {prompt}`, /--cmd takes a non-empty JSON array of strings/],
    ['an empty array', () => '[]', /--cmd takes a non-empty JSON array of strings/],
    ['{prompt} inside an element', (m) => JSON.stringify(['node', m, '--prompt={prompt}']), /\{prompt\} must be a whole element/],
    ['{prompt} inside a shell script', (m) => JSON.stringify(['sh', '-c', `node ${m} {prompt}`]), /\{prompt\} must be a whole element/],
  ])('%s is refused', (_, cmd, why) => {
    const root = workspace(files);
    const r = confirm(root, '', [`--cmd=${cmd(argvModel(root))}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(why);
  });

  test('the gishra command harness follows the same rule', () => {
    const root = workspace(hostileFiles);
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    const role = (command) => fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, ladder: { small: { harness: 'command', command } } }));
    const m = argvModel(root);
    role(['node', m, '{prompt}']);
    const out = JSON.parse(confirm(root, '', [], { GISHRA_STATE: state, EXPECT_LINE: hostile }).stdout);
    expect(out.error).toBeUndefined();
    expect(out.findings.map((f) => f.id)).toEqual([1, 2]);
    role(['sh', '-c', `node ${m} {prompt}`]);
    const r = confirm(root, '', [], { GISHRA_STATE: state });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\{prompt\} must be a whole element/);
  });
});

describe('prompt size', () => {
  // 200 CJK characters a line is 600 UTF-8 bytes but 200 UTF-16 units: a budget counted in
  // characters puts all of these in one prompt of about 140 KB, which exec refuses as an argument.
  test('multibyte context is batched by UTF-8 bytes, so each prompt can be passed as one argument', () => {
    const line = '中文'.repeat(100);
    const n = 43;
    const doc = Array.from({ length: n * 5 }, (_, i) => `${line} ${i}`).join('\n') + '\n';
    const root = workspace({ 'docs/zh.md': doc });
    const rep = { scope: 'diff', items: Array.from({ length: n }, (_, i) => ({ check: 'missing-path', severity: 'review', file: 'docs/zh.md', line: i * 5 + 3, message: `cites \`p${i}/x.js\`, which does not exist in this repo` })) };
    const calls = path.join(root, 'calls');
    const r = confirm(root, '', [`--cmd=${JSON.stringify(['node', argvModel(root), '{prompt}'])}`], { CALLS: calls }, rep);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBeUndefined();
    expect(out.findings.map((f) => f.id)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    const sizes = fs.readFileSync(calls, 'utf8').trim().split('\n').map(Number);
    expect(sizes.length).toBeGreaterThan(1);
    for (const b of sizes) expect(b).toBeLessThanOrEqual(96 * 1024);
  });

  test('one finding larger than a prompt is clipped to fit and still judged', () => {
    const root = workspace(files);
    const huge = '文'.repeat(60000); // 180 KB of message
    const rep = { scope: 'diff', items: [report.items[0], { ...report.items[1], message: huge }] };
    const calls = path.join(root, 'calls');
    const r = confirm(root, '', [`--cmd=${JSON.stringify(['node', argvModel(root), '{prompt}'])}`], { CALLS: calls }, rep);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBeUndefined();
    expect(out.findings.map((f) => f.id)).toEqual([1, 2]);
    for (const b of fs.readFileSync(calls, 'utf8').trim().split('\n').map(Number)) expect(b).toBeLessThanOrEqual(96 * 1024);
  });
});

// Exercise the real agnix entry point, not a stand-in that hides its symlink traversal.
test.each(['tracked', 'untracked'])('all checks skip %s agent-config symlinks before the model sees them', (tracking) => {
  const root = workspace({ ...files, 'scripts/old.sh': '#!/bin/sh\n' });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  fs.unlinkSync(path.join(root, 'scripts/old.sh'));
  const secret = 'PRIVATE-SYMLINK-CONTENT';
  const outside = workspace({ 'SKILL.md': `---\nname: ${secret}\ndescription: example\n---\nBody.\n` });
  fs.mkdirSync(path.join(root, 'skills', 'leaked'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'SKILL.md'), path.join(root, 'skills', 'leaked', 'SKILL.md'));
  // Internal links are refused too. A normal local file keeps the pipeline active.
  fs.writeFileSync(path.join(root, 'docs', 'local.md'), 'Local repeated prose\nLocal repeated prose\n');
  git('add', 'docs/local.md');
  fs.symlinkSync(path.join(root, 'docs', 'local.md'), path.join(root, 'docs', 'internal.md'));
  if (tracking === 'tracked') { git('add', '-A'); git('commit', '-q', '-m', 'links'); }
  const scopes = [['diff', true], ['repo', true]];
  if (tracking === 'tracked') scopes.push(['diff', false], ['repo', false]);
  for (const [scope, worktree] of scopes) {
    const detected = spawnSync('node', [DETECT, root, '--base=main', ...(worktree ? ['--worktree'] : []), `--scope=${scope}`, '--json'], { encoding: 'utf8' });
    expect(detected.status).toBe(0);
    const rep = JSON.parse(detected.stdout);
    const r = confirm(root, '', [`--cmd=${JSON.stringify(['node', argvModel(root)])}`], { NOT_IN_PROMPT: secret }, rep);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBeUndefined();
    expect(out.summary.confirmed).toBeGreaterThan(0);
    expect(detected.stdout).not.toContain(secret);
    expect(rep.items.some((it) => ['skills/leaked/SKILL.md', 'docs/internal.md'].includes(it.file))).toBe(false);
    expect(rep.skipped).toEqual(expect.arrayContaining(['symlink: skills/leaked/SKILL.md not scanned', 'symlink: docs/internal.md not scanned']));
    expect(out.skipped).toEqual(rep.skipped);
  }
});

test.each(['claude', 'codex', 'opencode', 'agy', 'pi', 'command'])('ladder.small inherits the %s project harness and runs it', (harness) => {
  const root = workspace(files);
  const state = path.join(root, 'state');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(state);
  fs.mkdirSync(bin);
  const standin = `#!${process.execPath}\nconst fs = require('fs');
const prompt = process.argv.slice(2).find((a) => a.startsWith('You are confirming')) || fs.readFileSync(0, 'utf8');
if (!prompt.includes('[1] stale-mention')) process.exit(3);
process.stdout.write(JSON.stringify({confirmed:[1,2],dismissed:[],fixes:[]}));\n`;
  fs.writeFileSync(path.join(bin, harness), standin, { mode: 0o755 });
  const small = harness === 'command' ? { command: [path.join(bin, harness)] } : harness === 'codex' ? { profile: 'luna' } : { model: 'test-small' };
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ harness, ladder: { small } }));
  const r = confirm(root, '', [], { GISHRA_STATE: state, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.error).toBeUndefined();
  expect(out.findings.map((f) => f.id)).toEqual([1, 2]);
});

test.each([
  { harness: 'codex', ladder: { small: {} } },
  { harness: 'pi', ladder: { small: { profile: 'luna' } } },
  { harness: 'claude', ladder: { small: { effort: 'low' } } },
  { harness: 'command', ladder: { small: { command: [] } } },
  { harness: 'unknown', ladder: { small: { model: 'm' } } },
  { harness: null, ladder: { small: { model: 'm' } } },
  { harness: 'codex', ladder: { small: { harness: null, profile: 'luna' } } },
  { harness: 'codex', ladder: null },
  { ladder: { small: null } },
  { roles: { small: { harness: 'codex', profile: 'luna' } } },
])('an unusable configured small rung fails loudly: %j', (project) => {
  const root = workspace(files);
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify(project));
  const r = confirm(root, '', ['--dry-run'], { GISHRA_STATE: state });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/ladder|small rung/);
  expect(r.stdout).not.toContain('Judge these');
});

test.each(['project', 'user', 'builtin'])('small rung resolution takes the %s layer as a whole', (layer) => {
  const root = workspace(files);
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const userFile = path.join(root, 'user.json');
  const project = layer === 'project'
    ? { harness: 'claude', ladder: { small: { harness: 'codex', profile: 'project-small' } } }
    : layer === 'user' ? { harness: 'pi' } : {};
  const user = layer === 'builtin' ? {} : { harness: 'claude', ladder: { small: { model: 'user-small' } } };
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify(project));
  fs.writeFileSync(userFile, JSON.stringify(user));
  const r = confirm(root, '', ['--dry-run'], { GISHRA_STATE: state, GISHRA_CONFIG: userFile });
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.model).toBe(layer === 'project' ? 'codex:project-small' : layer === 'user' ? 'pi:user-small' : 'codex:luna');
  if (layer === 'project') expect(out.argv).not.toContain('user-small');
});
