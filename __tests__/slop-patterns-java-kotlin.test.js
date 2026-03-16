/**
 * Tests for Java and Kotlin slop detection patterns
 * Covers 1 Java pattern (placeholder_unsupported_java)
 * 9 Java patterns and all 7 Kotlin patterns were removed during refactoring
 */

const {
  slopPatterns,
  getPatternsForLanguage,
  getPatternsForLanguageOnly,
  isFileExcluded,
  hasLanguage
} = require('../lib/patterns/slop-patterns');

const {
  detectLanguage,
  SOURCE_EXTENSIONS,
  isTestFile,
  ENTRY_POINTS,
  EXPORT_PATTERNS
} = require('../lib/patterns/slop-analyzers');

// ============================================================================
// Integration tests - Java
// ============================================================================

describe('Java language integration', () => {
  test('hasLanguage("java") returns true', () => {
    expect(hasLanguage('java')).toBe(true);
  });

  test('getPatternsForLanguageOnly("java") returns exactly 1 pattern', () => {
    const javaOnly = getPatternsForLanguageOnly('java');
    expect(Object.keys(javaOnly)).toHaveLength(1);
  });

  test('the 1 Java pattern name is present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('java'));
    expect(names).toContain('placeholder_unsupported_java');
  });

  test('getPatternsForLanguage("java") includes universal patterns', () => {
    const javaAll = getPatternsForLanguage('java');
    const javaOnly = getPatternsForLanguageOnly('java');
    expect(Object.keys(javaAll).length).toBeGreaterThan(Object.keys(javaOnly).length);
  });

  test('all Java patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('java'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'java');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// Integration tests - Kotlin
// ============================================================================

describe('Kotlin language integration', () => {
  test('hasLanguage("kotlin") returns false (no kotlin-specific patterns)', () => {
    expect(hasLanguage('kotlin')).toBe(false);
  });

  test('getPatternsForLanguageOnly("kotlin") returns 0 patterns', () => {
    const kotlinOnly = getPatternsForLanguageOnly('kotlin');
    expect(Object.keys(kotlinOnly)).toHaveLength(0);
  });

  test('getPatternsForLanguage("kotlin") returns only universal patterns', () => {
    const kotlinAll = getPatternsForLanguage('kotlin');
    const kotlinOnly = getPatternsForLanguageOnly('kotlin');
    expect(Object.keys(kotlinAll).length).toBeGreaterThan(Object.keys(kotlinOnly).length);
  });
});

// ============================================================================
// Infrastructure integration tests - detectLanguage, SOURCE_EXTENSIONS, etc.
// ============================================================================

describe('detectLanguage integration', () => {
  test('returns "java" for .java files', () => {
    expect(detectLanguage('Foo.java')).toBe('java');
  });

  test('returns "java" for path with .java extension', () => {
    expect(detectLanguage('src/main/java/com/example/Service.java')).toBe('java');
  });
});

describe('SOURCE_EXTENSIONS integration', () => {
  test('includes java with .java', () => {
    expect(SOURCE_EXTENSIONS.java).toEqual(['.java']);
  });
});

describe('isTestFile integration', () => {
  test('recognizes files in test directories', () => {
    expect(isTestFile('src/test/java/FooTest.java')).toBe(true);
  });

  test('does not flag regular Java source files', () => {
    expect(isTestFile('src/main/java/Service.java')).toBe(false);
  });
});

describe('ENTRY_POINTS integration', () => {
  test('includes Java entry points', () => {
    expect(ENTRY_POINTS).toContain('Main.java');
    expect(ENTRY_POINTS).toContain('Application.java');
    expect(ENTRY_POINTS).toContain('App.java');
  });
});

describe('EXPORT_PATTERNS integration', () => {
  test('includes java export patterns', () => {
    expect(EXPORT_PATTERNS.java).toBeDefined();
    expect(Array.isArray(EXPORT_PATTERNS.java)).toBe(true);
  });
});

// ============================================================================
// placeholder_unsupported_java (existing pattern)
// ============================================================================

describe('placeholder_unsupported_java', () => {
  const { pattern, exclude } = slopPatterns.placeholder_unsupported_java;

  test('matches throw new UnsupportedOperationException()', () => {
    expect(pattern.test('throw new UnsupportedOperationException();')).toBe(true);
  });

  test('matches with message', () => {
    expect(pattern.test('throw new UnsupportedOperationException("Not supported");')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    throw new UnsupportedOperationException();')).toBe(true);
  });

  test('does not match regular throw', () => {
    expect(pattern.test('throw new IllegalArgumentException("bad input");')).toBe(false);
  });

  test('does not match without throw', () => {
    expect(pattern.test('new UnsupportedOperationException();')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
    expect(isFileExcluded('src/test/FooTest.java', exclude)).toBe(true);
  });
});
