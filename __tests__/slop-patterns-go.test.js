/**
 * Tests for Go slop detection patterns
 * Covers all 1 Go-specific pattern (placeholder_panic_go)
 * 14 Go patterns were removed during refactoring
 */

const {
  slopPatterns,
  getPatternsForLanguage,
  getPatternsForLanguageOnly,
  isFileExcluded,
  hasLanguage
} = require('../lib/patterns/slop-patterns');

// ============================================================================
// Integration tests
// ============================================================================

describe('Go language integration', () => {
  test('hasLanguage("go") returns true', () => {
    expect(hasLanguage('go')).toBe(true);
  });

  test('getPatternsForLanguageOnly("go") returns exactly 1 pattern', () => {
    const goOnly = getPatternsForLanguageOnly('go');
    expect(Object.keys(goOnly)).toHaveLength(1);
  });

  test('the 1 Go pattern name is present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('go'));
    expect(names).toContain('placeholder_panic_go');
  });

  test('getPatternsForLanguage("go") includes universal patterns', () => {
    const goAll = getPatternsForLanguage('go');
    const goOnly = getPatternsForLanguageOnly('go');
    expect(Object.keys(goAll).length).toBeGreaterThan(Object.keys(goOnly).length);
  });

  test('all Go patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('go'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'go');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// placeholder_panic_go (existing pattern)
// ============================================================================

describe('placeholder_panic_go', () => {
  const { pattern, exclude } = slopPatterns.placeholder_panic_go;

  test('matches panic("TODO: implement")', () => {
    expect(pattern.test('panic("TODO: implement this")')).toBe(true);
  });

  test('matches panic with "not implemented"', () => {
    expect(pattern.test('panic("not implemented yet")')).toBe(true);
  });

  test('does not match panic with normal message', () => {
    expect(pattern.test('panic("unexpected state: invalid")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes testdata directory', () => {
    expect(isFileExcluded('pkg/testdata/fixture.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('pkg/handler.go', exclude)).toBe(false);
  });
});
