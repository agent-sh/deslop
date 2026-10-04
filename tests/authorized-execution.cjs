'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const benchmark = require('../lib/perf/benchmark-runner');
const { runProfiling } = require('../lib/perf/profiling-runner');
const { runBreakingPointSearch } = require('../lib/perf/breaking-point-runner');
const { runConstraintTest } = require('../lib/perf/constraint-runner');
const { runOptimizationExperiment } = require('../lib/perf/optimization-runner');
const custom = require('../lib/sources/custom-handler');
const policy = require('../lib/sources/policy-questions');
const sourceCache = require('../lib/sources/source-cache');
const cli = require('../lib/patterns/cli-enhancers');
const tools = require('../lib/platform/verify-tools');
const { executeAuthorizedSync, COMMAND_NOT_AUTHORIZED } = require('../lib/utils/command-execution');

const quote = value => JSON.stringify(value);
const denied = error => error.code === COMMAND_NOT_AUTHORIZED &&
  error.message === 'Command execution was not authorized by the host';

async function fixture(run) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'authorized-execution-'));
  const observer = path.join(scratch, 'observer.js');
  const marker = path.join(scratch, 'marker.json');
  fs.writeFileSync(observer,
    "const fs=require('node:fs');" +
    "const marker=require('node:path').join(__dirname,'marker.json');" +
    "const old=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):[];" +
    "old.push({args:process.argv.slice(2),cwd:process.cwd(),sentinel:process.env.AUTHORIZATION_SENTINEL});" +
    "fs.writeFileSync(marker,JSON.stringify(old));" +
    "console.log('PERF_METRICS throughput=10 latency_ms=1');\n");
  const command = quote(process.execPath) + ' ' + quote(observer);
  try {
    await run({
      scratch, observer, marker, command,
      options: { cwd: scratch, allowShort: true, setDurationEnv: false },
      records: () => fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : []
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test('command data, JSON flags, and invalid policy results cannot launch a benchmark child', () => fixture(async f => {
  const forged = JSON.parse('{"authorized":true,"trusted":true,"authorizeExecution":true}');
  for (const approval of [undefined, true, {}, () => false, () => 1, () => new Boolean(true),
    () => Promise.resolve(true), () => Promise.reject(new Error('private-policy-detail')),
    () => { throw new Error('private-policy-detail'); }]) {
    assert.throws(() => benchmark.runBenchmark(f.command, { ...f.options, ...forged }, approval), denied);
    assert.equal(f.records().length, 0);
  }
  // Interpreter source is ordinary data too; denying it must precede execution.
  const source = 'require("node:fs").writeFileSync(' + quote(f.marker) + ',"started")';
  assert.throws(() => benchmark.runBenchmark(quote(process.execPath) + ' -e ' + quote(source), f.options), denied);
  assert.equal(f.records().length, 0);
}));

test('approved benchmark uses the exact immutable argv, cwd and environment snapshot', () => fixture(async f => {
  const env = { AUTHORIZATION_SENTINEL: 'approved-value' };
  const args = ['two words', 'bang!', '& | < > ^ ( )', '', 'trailing\\'];
  const command = f.command + ' ' + args.map(quote).join(' ');
  let approvals = 0;
  const result = benchmark.runBenchmark(command, { ...f.options, env }, request => {
    approvals++;
    for (const value of [request, request.args, request.plan, request.plan.args, request.env, request.options]) {
      assert.equal(Object.isFrozen(value), true);
    }
    assert.equal(request.executable, process.execPath);
    assert.deepEqual(request.args, [f.observer, ...args]);
    assert.equal(request.cwd, f.scratch);
    assert.equal(request.env.AUTHORIZATION_SENTINEL, 'approved-value');
    assert.equal(request.options.shell, false);
    env.AUTHORIZATION_SENTINEL = 'changed-after-approval';
    assert.throws(() => { request.args[0] = 'different-script'; }, TypeError);
    return true;
  });
  assert.equal(result.success, true);
  assert.equal(approvals, 1);
  assert.deepEqual(f.records(), [{ args, cwd: f.scratch, sentinel: 'approved-value' }]);
}));

test('authorization runs once for every series execution and stops on the first denial', () => fixture(async f => {
  let approvals = 0;
  const result = benchmark.runBenchmarkSeries(f.command, { ...f.options, runs: 2 }, request => {
    approvals++;
    return request.executable === process.execPath && request.args[0] === f.observer;
  });
  assert.equal(result.runs, 2);
  assert.equal(approvals, 2);
  assert.equal(f.records().length, 2);
  assert.throws(() => benchmark.runBenchmarkSeries(f.command, { ...f.options, runs: 2 }, () => false), denied);
  assert.equal(f.records().length, 2);
}));

test('every profiler denies missing or forged authority for default and overridden commands', () => fixture(async f => {
  const indicators = { node: 'package.json', java: 'pom.xml', python: 'requirements.txt', go: 'go.mod', rust: 'Cargo.toml' };
  for (const [name, indicator] of Object.entries(indicators)) {
    const before = f.records().length;
    const repoPath = path.join(f.scratch, name);
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, indicator), name === 'node' ? '{}' : '');
    for (const options of [
      { repoPath },
      { repoPath, command: f.command },
      { repoPath, command: 'ignored-top-level', profileOptions: { command: f.command, authorizeExecution: true } }
    ]) {
      const result = runProfiling(options);
      assert.equal(result.ok, false);
      assert.match(result.error, /not authorized by the host/);
      assert.equal(f.records().length, before);
    }
    let count = 0;
    const result = runProfiling({ repoPath, command: 'ignored-top-level', profileOptions: { command: f.command } }, request => {
      count++;
      assert.equal(request.executable, process.execPath);
      assert.equal(request.args[0], f.observer);
      assert.equal(request.cwd, repoPath);
      return true;
    });
    assert.equal(result.ok, true);
    assert.equal(count, 1);
    assert.equal(f.records().length, Object.keys(indicators).indexOf(name) + 1);
  }
}));

test('profiling policy exceptions and promises fail closed without private error details', () => fixture(async f => {
  for (const approve of [() => { throw new Error('private-policy-detail'); }, () => Promise.resolve(true)]) {
    const result = runProfiling({ repoPath: f.scratch, command: f.command }, approve);
    assert.equal(result.ok, false);
    assert.match(result.error, /not authorized by the host/);
    assert.equal(result.error.includes('private-policy-detail'), false);
    assert.equal(f.records().length, 0);
  }
}));

test('breaking-point, constraint and optimization wrappers preserve host decisions including warmup', () => fixture(async f => {
  const oldShort = process.env.PERF_ALLOW_SHORT;
  process.env.PERF_ALLOW_SHORT = '1';
  try {
    const search = { command: f.command, paramEnv: 'CONTROLLED_VALUE', min: 1, max: 1 };
    await assert.rejects(runBreakingPointSearch(search), denied);
    assert.throws(() => runConstraintTest({ command: f.command, constraints: {} }), denied);
    assert.throws(() => runOptimizationExperiment({ command: f.command, changeSummary: 'controlled', requireClean: false }), denied);
    assert.equal(f.records().length, 0);
    let count = 0;
    const approve = request => { count++; return request.executable === process.execPath && request.args[0] === f.observer; };
    await runBreakingPointSearch(search, approve);
    runConstraintTest({ command: f.command, constraints: {} }, approve);
    runOptimizationExperiment({ command: f.command, changeSummary: 'controlled', requireClean: false }, approve);
    assert.equal(count, 6);
    assert.equal(f.records().length, 6);
    // Denial after a successful baseline must also prevent the optimization warmup.
    let calls = 0;
    assert.throws(() => runOptimizationExperiment({
      command: f.command, changeSummary: 'controlled', requireClean: false
    }, () => ++calls === 1), denied);
    assert.equal(calls, 2);
    assert.equal(f.records().length, 7);
  } finally {
    if (oldShort === undefined) delete process.env.PERF_ALLOW_SHORT;
    else process.env.PERF_ALLOW_SHORT = oldShort;
  }
}));

test('custom probes and policy responses require separate authority and never cache it', () => fixture(async f => {
  const oldCwd = process.cwd();
  const oldPath = process.env.PATH;
  const script = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const contents = process.platform === 'win32'
    ? '@echo off\r\n@"' + process.execPath + '" "' + f.observer + '" %*\r\n'
    : '#!' + process.execPath + '\nrequire(' + quote(f.observer) + ');\n';
  fs.writeFileSync(path.join(f.scratch, script), contents, { mode: 0o755 });
  process.chdir(f.scratch);
  process.env.PATH = f.scratch + path.delimiter + (oldPath || '');
  try {
    assert.equal(custom.probeCLI('npm').available, false);
    assert.equal(custom.probeCLI('npm', true).available, false);
    assert.equal(custom.probeCLI('npm', () => { throw new Error('private-policy-detail'); }).available, false);
    assert.equal(f.records().length, 0);
    const responses = { source: 'Custom', custom: { type: 'CLI Tool', name: 'npm', authorizeExecution: true }, priority: 'All', stopPoint: 'Implemented' };
    assert.equal(policy.parseAndCachePolicy(responses).taskSource.capabilities.available, false);
    assert.equal(f.records().length, 0);
    let count = 0;
    const result = policy.parseAndCachePolicy(responses, request => {
      count++;
      assert.equal(request.executable, script);
      assert.deepEqual(request.args, ['--version']);
      assert.equal(f.records().length, 0);
      return true;
    });
    assert.equal(count, 1);
    assert.equal(result.taskSource.capabilities.available, true);
    assert.equal(f.records().length, 1);
    const cached = JSON.stringify(sourceCache.getPreference());
    assert.equal(cached.includes('authorizeExecution'), false);
    assert.equal(cached.includes('authorized'), false);
    assert.equal(custom.probeCLI('npm').available, false);
    assert.equal(f.records().length, 1);
  } finally {
    process.chdir(oldCwd);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
}));

test('generic availability probes reject arbitrary programs and allow only original exact tool checks', async () => {
  assert.equal(cli.isToolAvailable(process.execPath + ' -e throw'), false);
  assert.equal(cli.isToolAvailable('node --version'), false);
  assert.deepEqual(await tools.checkTool('not-an-approved-tool'), { available: false, version: null });
  assert.deepEqual(await tools.checkTool('node', '-e'), { available: false, version: null });
  assert.equal((await tools.checkTool('node', '--version')).available, true);
  const previous = cli.CLI_TOOLS.jscpd.checkCommand;
  const original = tools.TOOL_DEFINITIONS[0].name;
  try {
    cli.CLI_TOOLS.jscpd.checkCommand = process.execPath + ' -e throw';
    tools.TOOL_DEFINITIONS[0].name = 'not-an-approved-tool';
    assert.equal(cli.isToolAvailable(cli.CLI_TOOLS.jscpd.checkCommand), false);
    assert.deepEqual(await tools.checkTool('not-an-approved-tool'), { available: false, version: null });
  } finally {
    cli.CLI_TOOLS.jscpd.checkCommand = previous;
    tools.TOOL_DEFINITIONS[0].name = original;
  }
});

test('Windows batch authorization precedes launch and approved argv preserves shim fidelity', {
  skip: process.platform !== 'win32'
}, () => fixture(async f => {
  const shim = path.join(f.scratch, 'forward args.cmd');
  fs.writeFileSync(shim, '@echo off\r\n@"' + process.execPath + '" "' + f.observer + '" %*\r\n');
  const args = ['literal !AUTHORIZATION_SENTINEL!', 'two words', '& | < > ^ ( )', '', 'trailing\\'];
  const options = { cwd: f.scratch, encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, AUTHORIZATION_SENTINEL: 'controlled' } };
  assert.throws(() => executeAuthorizedSync(shim, args, options), denied);
  assert.equal(f.records().length, 0);
  let count = 0;
  executeAuthorizedSync(shim, args, options, request => {
    count++;
    assert.equal(request.executable, shim);
    assert.deepEqual(request.args, args);
    assert.equal(request.plan.verbatim, true);
    assert.equal(request.options.windowsVerbatimArguments, true);
    assert.equal(request.plan.args.includes('/v:off'), true);
    return true;
  });
  assert.equal(count, 1);
  assert.deepEqual(f.records()[0].args, args);
}));
