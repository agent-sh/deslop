'use strict';

/**
 * scripts/detect.js file targeting: files after the repo path, or from
 * --files-from, are exactly what gets scanned.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const detect = path.resolve(__dirname, '..', 'scripts', 'detect.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deslop-detect-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (const name of ['a', 'b']) {
    fs.writeFileSync(path.join(dir, 'src', `${name}.js`), `function ${name}() {\n  console.log("x");\n  return 1;\n}\nmodule.exports = ${name};\n`);
  }
  return dir;
}

function run(dir, args, input) {
  const r = spawnSync(process.execPath, [detect, ...args], { cwd: dir, encoding: 'utf8', input });
  return JSON.parse(r.stdout);
}

const files = result => [...new Set(result.findings.map(f => f.file))].sort();

describe('detect.js file targets', () => {
  let dir;
  beforeEach(() => { dir = repo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('without files it scans the tree', () => {
    expect(files(run(dir, ['.']))).toEqual(['src/a.js', 'src/b.js']);
  });

  test('files after the path limit the scan to those files', () => {
    expect(files(run(dir, ['.', 'src/b.js']))).toEqual(['src/b.js']);
  });

  test('--files-from - reads the list from stdin and skips missing files', () => {
    expect(files(run(dir, ['.', '--files-from', '-'], 'src/a.js\nsrc/gone.js\n'))).toEqual(['src/a.js']);
  });

  test('a list with no existing files reports nothing', () => {
    expect(run(dir, ['.', 'src/gone.js']).findings).toEqual([]);
  });
});
