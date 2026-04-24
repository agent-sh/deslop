'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const signals = require('../lib/repo-intel-signals');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deslop-signals-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('repo-intel-signals', () => {
  describe('hasRepoIntel', () => {
    test('returns false when no state dir + map file present', () => {
      const cwd = tempRepo();
      try {
        expect(signals.hasRepoIntel(cwd)).toBe(false);
      } finally {
        cleanup(cwd);
      }
    });

    test('returns true when .claude/repo-intel.json exists', () => {
      const cwd = tempRepo();
      try {
        fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.claude', 'repo-intel.json'), '{}');
        expect(signals.hasRepoIntel(cwd)).toBe(true);
      } finally {
        cleanup(cwd);
      }
    });

    test('prefers existing state dir over .claude default', () => {
      const cwd = tempRepo();
      try {
        fs.mkdirSync(path.join(cwd, '.opencode'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.opencode', 'repo-intel.json'), '{}');
        expect(signals.hasRepoIntel(cwd)).toBe(true);
        expect(signals.mapFilePath(cwd)).toContain('.opencode');
      } finally {
        cleanup(cwd);
      }
    });
  });

  describe('toDeslopFix', () => {
    test('maps delete-file action to fixType delete-file', () => {
      const fix = signals.toDeslopFix({
        action: 'delete-file',
        path: 'debug.log',
        category: 'tracked-artifact',
        reason: 'tracked log file at repo root'
      });
      expect(fix).toMatchObject({
        file: 'debug.log',
        fixType: 'delete-file',
        pattern: 'tracked-artifact',
        certainty: 'HIGH',
        source: 'analyzer-slop-fixes'
      });
    });

    test('maps delete-lines action with line range', () => {
      const fix = signals.toDeslopFix({
        action: 'delete-lines',
        path: 'src/api.ts',
        lines: [42, 50],
        category: 'empty-catch',
        reason: 'empty catch block'
      });
      expect(fix).toMatchObject({
        file: 'src/api.ts',
        fixType: 'remove-line',
        line: 42,
        endLine: 50
      });
    });

    test('maps replace-lines action with replacement text', () => {
      const fix = signals.toDeslopFix({
        action: 'replace-lines',
        path: 'src/x.ts',
        lines: [10, 12],
        with: '// fixed',
        category: 'tautological-test',
        reason: 'test'
      });
      expect(fix).toMatchObject({
        fixType: 'replace',
        line: 10,
        endLine: 12,
        replacement: '// fixed'
      });
    });

    test('returns null for unknown action', () => {
      expect(signals.toDeslopFix({ action: 'mystery', path: 'x' })).toBeNull();
    });

    test('returns null for delete-lines without a valid lines array', () => {
      expect(
        signals.toDeslopFix({ action: 'delete-lines', path: 'x', category: 'c', reason: 'r' })
      ).toBeNull();
      expect(
        signals.toDeslopFix({
          action: 'delete-lines',
          path: 'x',
          lines: [42],
          category: 'c',
          reason: 'r'
        })
      ).toBeNull();
      expect(
        signals.toDeslopFix({
          action: 'delete-lines',
          path: 'x',
          lines: ['a', 'b'],
          category: 'c',
          reason: 'r'
        })
      ).toBeNull();
    });

    test('returns null for replace-lines without a valid lines array', () => {
      expect(
        signals.toDeslopFix({
          action: 'replace-lines',
          path: 'x',
          with: 'y',
          category: 'c',
          reason: 'r'
        })
      ).toBeNull();
    });

    test('returns null for delete-file without a path', () => {
      expect(signals.toDeslopFix({ action: 'delete-file', category: 'c', reason: 'r' })).toBeNull();
    });
  });

  describe('targetsToFileList', () => {
    test('returns empty array for null or missing targets', () => {
      expect(signals.targetsToFileList(null)).toEqual([]);
      expect(signals.targetsToFileList({})).toEqual([]);
    });

    test('extracts file paths and sorts by descending score', () => {
      const result = {
        targets: [
          { kind: 'file', path: 'a.ts', score: 5.0 },
          { kind: 'file', path: 'b.ts', score: 9.5 },
          { kind: 'file', path: 'c.ts', score: 7.2 }
        ]
      };
      expect(signals.targetsToFileList(result)).toEqual(['b.ts', 'c.ts', 'a.ts']);
    });

    test('flattens area paths into the list', () => {
      const result = {
        targets: [
          { kind: 'file', path: 'one.ts', score: 8.0 },
          { kind: 'area', paths: ['a.ts', 'b.ts'], score: 6.0 }
        ]
      };
      expect(signals.targetsToFileList(result)).toEqual(['one.ts', 'a.ts', 'b.ts']);
    });

    test('deduplicates paths across file and area entries', () => {
      const result = {
        targets: [
          { kind: 'file', path: 'shared.ts', score: 8.0 },
          { kind: 'area', paths: ['shared.ts', 'other.ts'], score: 7.0 }
        ]
      };
      expect(signals.targetsToFileList(result)).toEqual(['shared.ts', 'other.ts']);
    });
  });
});
