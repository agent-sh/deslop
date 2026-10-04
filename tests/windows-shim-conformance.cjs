'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planShimSpawn, shimSpawnOptions } = require('../lib/utils/command-parser');

const ordinaryArgs = [
  'literal !SHIM_CONFORMANCE_SENTINEL! text',
  'two words',
  'ampersand & value',
  'pipe | value',
  'angles < value >',
  'caret ^ value',
  '(parentheses)',
  '',
  'trailing\\',
  'bang!',
];

test('ordinary executable arguments remain unchanged', () => {
  const args = ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...ordinaryArgs];
  const plan = planShimSpawn(process.execPath, args);
  assert.equal(plan.verbatim, false);
  assert.strictEqual(plan.args, args);
  const result = spawnSync(plan.file, plan.args, shimSpawnOptions(plan, {
    encoding: 'utf8',
    timeout: 10000,
    env: {},
  }));
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ordinaryArgs);
});

test('batch plans reject existing unrepresentable tokens before launch', () => {
  const options = { platform: 'win32', comspec: 'cmd.exe' };
  for (const value of ['literal"quote', 'literal%percent', 'line\rbreak', 'line\nbreak', 'null\0byte']) {
    assert.throws(() => planShimSpawn('forward.cmd', [value], options));
    assert.throws(() => planShimSpawn(value + '.cmd', [], options));
  }
  assert.throws(() => planShimSpawn('forward.cmd', [1], options), /must be a string/);
});

test('Windows batch shim preserves literal arguments with delayed expansion initially on', {
  skip: process.platform !== 'win32',
}, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-argv-conformance-'));
  try {
    const shim = path.join(scratch, 'forward args.cmd');
    const observer = path.join(scratch, 'observe argv.js');
    fs.writeFileSync(observer, "'use strict';\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    fs.writeFileSync(shim, '@echo off\r\n@"' + process.execPath + '" "' + observer + '" %*\r\n');

    const comspec = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
    const plan = planShimSpawn(shim, ordinaryArgs, { platform: 'win32', comspec });
    const controlledEnv = {
      SystemRoot: process.env.SystemRoot,
      SHIM_CONFORMANCE_SENTINEL: 'expanded-only-in-legacy-control',
    };
    function observe(candidate) {
      // The initial /v:on supplies the setting that our planner must override.
      const result = spawnSync(candidate.file, ['/v:on', ...candidate.args], shimSpawnOptions(candidate, {
        cwd: scratch,
        encoding: 'utf8',
        env: controlledEnv,
        timeout: 10000,
        windowsHide: true,
      }));
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.trim());
    }

    // A bounded legacy control shows argument alteration, with no other command or target.
    const legacy = { ...plan, args: plan.args.filter(arg => arg !== '/v:off') };
    const altered = observe(legacy);
    assert.equal(altered[0], 'literal expanded-only-in-legacy-control text');
    assert.notDeepEqual(altered, ordinaryArgs);
    assert.deepEqual(observe(plan), ordinaryArgs);
  } finally {
    fs.rmSync(scratch, { recursive: true });
  }
});
