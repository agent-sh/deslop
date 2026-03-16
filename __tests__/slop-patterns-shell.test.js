/**
 * Tests for Shell/Bash slop detection patterns
 * Currently there are no shell-specific patterns in the patterns module.
 * All shell patterns were removed during the refactoring.
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

describe('Shell language integration', () => {
  test('hasLanguage("shell") returns false (no shell-specific patterns)', () => {
    expect(hasLanguage('shell')).toBe(false);
  });

  test('getPatternsForLanguageOnly("shell") returns 0 patterns', () => {
    const shellOnly = getPatternsForLanguageOnly('shell');
    expect(Object.keys(shellOnly)).toHaveLength(0);
  });

  test('getPatternsForLanguage("shell") returns only universal patterns', () => {
    const shellAll = getPatternsForLanguage('shell');
    const shellOnly = getPatternsForLanguageOnly('shell');
    // Without shell-specific patterns, getPatternsForLanguage returns only universal
    expect(Object.keys(shellAll).length).toBeGreaterThan(Object.keys(shellOnly).length);
  });
});
