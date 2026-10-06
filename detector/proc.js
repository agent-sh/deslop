'use strict';
// Every program the detector runs (git, rg, linters) goes through run(). A program that could
// not start, was killed, timed out, overflowed the buffer or exited with a status it does not
// use for an answer throws, and the check that asked fails with that error. Read as "nothing
// found", any of those would let the check report a clean change.
const { spawnSync } = require('child_process');

const MAX = 256 * 1024 * 1024;

// `ok` lists the exit statuses that are answers: grep-like tools exit 1 for "no match",
// linters exit 1 for "found problems".
function run(bin, args, { name = bin, cwd, input, ok = [0], timeout, encoding = 'utf8', maxBuffer = MAX } = {}) {
  // A string input is encoded with `encoding`, which fails for 'buffer'; send UTF-8 bytes.
  const r = spawnSync(bin, args, { cwd, input: typeof input === 'string' ? Buffer.from(input) : input, encoding, maxBuffer, timeout });
  let why = null;
  if (r.error && r.error.code === 'ETIMEDOUT') why = `timed out after ${timeout / 1000}s`;
  else if (r.error && r.error.code === 'ENOBUFS') why = `printed over ${maxBuffer} bytes`;
  else if (r.error) why = `could not run: ${r.error.message}`;
  else if (r.signal) why = `killed by ${r.signal}`;
  else if (!ok.includes(r.status)) why = `exit ${r.status}`;
  if (why) {
    // Tools put the cause last (cargo's "Caused by:" chain), so a long message keeps both ends.
    let err = String(r.stderr || '').trim().replace(/\s+/g, ' ');
    if (err.length > 300) err = `${err.slice(0, 140)} ... ${err.slice(-140)}`;
    throw new Error(`${name} failed (${why})${err ? `: ${err}` : ''}`);
  }
  return r;
}

// A tool that answers in JSON. Output that does not parse throws, like a failed run. `empty`
// is what no output means for a tool that prints nothing on a clean input; for any other tool
// no output is a failure too.
function runJson(bin, args, opts = {}) {
  const out = run(bin, args, opts).stdout.trim();
  if (!out && opts.empty !== undefined) return opts.empty;
  try { return JSON.parse(out); } catch {
    throw new Error(`${opts.name || bin} printed no JSON report: ${out.slice(0, 200)}`);
  }
}

// Whether a tool is on PATH (or at the given path) and answers --version. Cached per process.
const have = new Map();
function installed(bin) {
  if (!have.has(bin)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    have.set(bin, !r.error && r.status === 0);
  }
  return have.get(bin);
}

module.exports = { run, runJson, installed, MAX };
