/**
 * Tests for C and C++ slop detection patterns
 * Currently there are no C or C++ specific patterns in the patterns module.
 * All C/C++ patterns were removed during the refactoring.
 */

const {
  slopPatterns,
  getPatternsForLanguage,
  getPatternsForLanguageOnly,
  isFileExcluded,
  hasLanguage
} = require('../lib/patterns/slop-patterns');

// ============================================================================
// Integration tests - C
// ============================================================================

describe('C language integration', () => {
  test('hasLanguage("c") returns false (no C-specific patterns)', () => {
    expect(hasLanguage('c')).toBe(false);
  });

  test('getPatternsForLanguageOnly("c") returns 0 patterns', () => {
    const cOnly = getPatternsForLanguageOnly('c');
    expect(Object.keys(cOnly)).toHaveLength(0);
  });

  test('getPatternsForLanguage("c") returns only universal patterns', () => {
    const cAll = getPatternsForLanguage('c');
    const cOnly = getPatternsForLanguageOnly('c');
    expect(Object.keys(cAll).length).toBeGreaterThan(Object.keys(cOnly).length);
  });
});

// ============================================================================
// Integration tests - C++
// ============================================================================

describe('C++ language integration', () => {
  test('hasLanguage("cpp") returns false (no C++-specific patterns)', () => {
    expect(hasLanguage('cpp')).toBe(false);
  });

  test('getPatternsForLanguageOnly("cpp") returns 0 patterns', () => {
    const cppOnly = getPatternsForLanguageOnly('cpp');
    expect(Object.keys(cppOnly)).toHaveLength(0);
  });

  test('getPatternsForLanguage("cpp") returns only universal patterns', () => {
    const cppAll = getPatternsForLanguage('cpp');
    const cppOnly = getPatternsForLanguageOnly('cpp');
    expect(Object.keys(cppAll).length).toBeGreaterThan(Object.keys(cppOnly).length);
  });
});
