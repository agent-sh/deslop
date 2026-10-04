'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { types } = require('node:util');
const { resolveExecutableForPlatform, planShimSpawn, shimSpawnOptions } = require('./command-parser');

const COMMAND_NOT_AUTHORIZED = 'ERR_COMMAND_NOT_AUTHORIZED';
const nativePromiseThen = Promise.prototype.then;

function denied() {
  const error = new Error('Command execution was not authorized by the host');
  error.code = COMMAND_NOT_AUTHORIZED;
  return error;
}

/**
 * The host supplies authorizeExecution separately from request/configuration data.
 * It must synchronously approve the complete immutable invocation with literal true.
 * This authorizes execution; it does not sandbox the approved program or repository.
 */
function executeAuthorizedSync(executable, args, options, authorizeExecution) {
  if (typeof authorizeExecution !== 'function') throw denied();
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw denied();
  }
  if (options.stdio !== undefined && !['pipe', 'ignore'].includes(options.stdio)) throw denied();
  if (options.encoding !== undefined && typeof options.encoding !== 'string') throw denied();
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout < 0)) throw denied();
  if (options.windowsHide !== undefined && typeof options.windowsHide !== 'boolean') throw denied();

  const resolved = resolveExecutableForPlatform(executable);
  const argv = Object.freeze([...args]);
  const planned = planShimSpawn(resolved, argv);
  const plan = Object.freeze({ ...planned, args: Object.freeze([...planned.args]) });
  const env = Object.create(null);
  for (const [key, value] of Object.entries(options.env || process.env)) {
    if (value === undefined || value === null) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw denied();
    env[key] = String(value);
  }
  Object.freeze(env);
  const execOptions = Object.freeze(shimSpawnOptions(plan, {
    stdio: options.stdio || 'pipe',
    encoding: options.encoding,
    timeout: options.timeout,
    windowsHide: options.windowsHide,
    cwd: path.resolve(options.cwd || process.cwd()),
    env,
    shell: false
  }));
  const request = Object.freeze({
    executable: resolved,
    args: argv,
    platform: process.platform,
    plan,
    cwd: execOptions.cwd,
    env,
    options: execOptions
  });

  let approved;
  try {
    approved = authorizeExecution(request);
  } catch {
    throw denied();
  }
  if (approved !== true) {
    // A mistaken async policy must fail closed without leaking a rejected promise.
    if (types.isPromise(approved)) {
      try {
        // Realm-independent detection and the intrinsic avoid instance overrides.
        Reflect.apply(nativePromiseThen, approved, [undefined, () => {}]);
      } catch {
        // Cleanup cannot expose a policy exception instead of the generic denial.
      }
    }
    throw denied();
  }
  return execFileSync(plan.file, plan.args, execOptions);
}

module.exports = { executeAuthorizedSync, COMMAND_NOT_AUTHORIZED };
