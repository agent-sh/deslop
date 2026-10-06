'use strict';
// The confirm step: a stand-in model command replies, and the result must hold only what the
// reply and the files support. No real model is called.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIRM = path.join(__dirname, '..', 'scripts', 'confirm.js');
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

test('with no model configured the findings are printed for the caller to judge', () => {
  const root = workspace(files);
  const r = confirm(root, '');
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^deslop-confirm: no small model configured/);
  expect(r.stdout).toContain('[2] missing-path (review) docs/setup.md:3');
  expect(r.stdout).toContain('>     3 | See path/to/example.js');
});

test('the gishra small role runs a command harness with the prompt substituted', () => {
  const root = workspace(files);
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const model = JSON.parse(fakeModel(root));
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, roles: { small: { harness: 'command', command: [...model, '{prompt}'] } } }));
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
    [{ harness: 'pi' }, ['pi', '-p', 'PROMPT']],
  ];
  test.each(shapes)('%j', (role, expected) => {
    const root = workspace(files);
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, roles: { small: role } }));
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
    const role = (command) => fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, roles: { small: { harness: 'command', command } } }));
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
