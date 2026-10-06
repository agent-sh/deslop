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

// A model stand-in: prints the reply given in REPLY, after checking the prompt it got.
function fakeModel(root) {
  const p = path.join(root, 'model.js');
  fs.writeFileSync(p, `const fs = require('fs');
const prompt = process.env.DESLOP_PROMPT || fs.readFileSync(0, 'utf8');
if (!prompt.includes('[1] stale-mention (high) docs/setup.md:2') || !prompt.includes('>     2 | Run scripts/old.sh first.')) { console.error('bad prompt'); process.exit(3); }
process.stdout.write(process.env.REPLY);
`);
  return `node ${p}`;
}

function confirm(root, reply, args = [], env = {}) {
  const input = path.join(root, 'report.json');
  fs.writeFileSync(input, JSON.stringify(report));
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
  const model = fakeModel(root).split(' ');
  fs.writeFileSync(path.join(state, 'project.json'), JSON.stringify({ version: 1, roles: { small: { harness: 'command', command: ['sh', '-c', 'DESLOP_PROMPT="$1" exec "$0" "$2"', model[0], '{prompt}', model[1]] } } }));
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
