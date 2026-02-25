/**
 * Tests for Java and Kotlin slop detection patterns
 * Covers 10 Java patterns (1 existing + 9 new) and 6 Kotlin patterns
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
  detectCommentLanguage,
  SOURCE_EXTENSIONS,
  COMMENT_SYNTAX,
  isTestFile,
  ENTRY_POINTS,
  EXPORT_PATTERNS
} = require('../lib/patterns/slop-analyzers');

const {
  detectProjectLanguages,
  SUPPORTED_LANGUAGES
} = require('../lib/patterns/cli-enhancers');

// ============================================================================
// Integration tests - Java
// ============================================================================

describe('Java language integration', () => {
  test('hasLanguage("java") returns true', () => {
    expect(hasLanguage('java')).toBe(true);
  });

  test('getPatternsForLanguageOnly("java") returns exactly 10 patterns', () => {
    const javaOnly = getPatternsForLanguageOnly('java');
    expect(Object.keys(javaOnly)).toHaveLength(10);
  });

  test('all 10 Java pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('java'));
    expect(names).toContain('placeholder_unsupported_java');
    expect(names).toContain('java_sysout_debugging');
    expect(names).toContain('java_stacktrace_debugging');
    expect(names).toContain('java_throw_todo');
    expect(names).toContain('java_return_null_todo');
    expect(names).toContain('java_empty_catch');
    expect(names).toContain('java_catch_ignore');
    expect(names).toContain('java_suppress_warnings');
    expect(names).toContain('java_raw_type');
    expect(names).toContain('java_wildcard_catch');
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
  test('hasLanguage("kotlin") returns true', () => {
    expect(hasLanguage('kotlin')).toBe(true);
  });

  test('getPatternsForLanguageOnly("kotlin") returns exactly 6 patterns', () => {
    const kotlinOnly = getPatternsForLanguageOnly('kotlin');
    expect(Object.keys(kotlinOnly)).toHaveLength(6);
  });

  test('all 6 Kotlin pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('kotlin'));
    expect(names).toContain('kotlin_println_debugging');
    expect(names).toContain('kotlin_todo_call');
    expect(names).toContain('kotlin_fixme_comment');
    expect(names).toContain('kotlin_empty_catch');
    expect(names).toContain('kotlin_swallowed_error');
    expect(names).toContain('kotlin_suppress_annotation');
  });

  test('getPatternsForLanguage("kotlin") includes universal patterns', () => {
    const kotlinAll = getPatternsForLanguage('kotlin');
    const kotlinOnly = getPatternsForLanguageOnly('kotlin');
    expect(Object.keys(kotlinAll).length).toBeGreaterThan(Object.keys(kotlinOnly).length);
  });

  test('all Kotlin patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('kotlin'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'kotlin');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
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

  test('returns "kotlin" for .kt files', () => {
    expect(detectLanguage('Bar.kt')).toBe('kotlin');
  });

  test('returns "kotlin" for .kts files', () => {
    expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
  });

  test('returns "kotlin" for path with .kt extension', () => {
    expect(detectLanguage('src/main/kotlin/com/example/Service.kt')).toBe('kotlin');
  });
});

describe('detectCommentLanguage integration', () => {
  test('returns "java" for .java extension', () => {
    expect(detectCommentLanguage('.java')).toBe('java');
  });

  test('returns "kotlin" for .kt extension', () => {
    expect(detectCommentLanguage('.kt')).toBe('kotlin');
  });

  test('returns "kotlin" for .kts extension', () => {
    expect(detectCommentLanguage('.kts')).toBe('kotlin');
  });
});

describe('SOURCE_EXTENSIONS integration', () => {
  test('includes kotlin with .kt and .kts', () => {
    expect(SOURCE_EXTENSIONS.kotlin).toEqual(['.kt', '.kts']);
  });

  test('includes java with .java', () => {
    expect(SOURCE_EXTENSIONS.java).toEqual(['.java']);
  });
});

describe('COMMENT_SYNTAX integration', () => {
  test('includes java with // and /* */ syntax', () => {
    expect(COMMENT_SYNTAX.java).toBeDefined();
    expect(COMMENT_SYNTAX.java.line).toBeDefined();
    expect(COMMENT_SYNTAX.java.block).toBeDefined();
  });

  test('includes kotlin with // and /* */ syntax', () => {
    expect(COMMENT_SYNTAX.kotlin).toBeDefined();
    expect(COMMENT_SYNTAX.kotlin.line).toBeDefined();
    expect(COMMENT_SYNTAX.kotlin.block).toBeDefined();
  });
});

describe('isTestFile integration', () => {
  test('recognizes Java test files', () => {
    expect(isTestFile('FooTest.java')).toBe(true);
    expect(isTestFile('src/test/java/FooTest.java')).toBe(true);
  });

  test('recognizes Kotlin test files', () => {
    expect(isTestFile('BarTest.kt')).toBe(true);
    expect(isTestFile('src/test/kotlin/BarTest.kt')).toBe(true);
  });

  test('does not flag regular Java/Kotlin source files', () => {
    expect(isTestFile('src/main/java/Service.java')).toBe(false);
    expect(isTestFile('src/main/kotlin/Service.kt')).toBe(false);
  });
});

describe('ENTRY_POINTS integration', () => {
  test('includes Kotlin entry points', () => {
    expect(ENTRY_POINTS).toContain('Main.kt');
    expect(ENTRY_POINTS).toContain('Application.kt');
    expect(ENTRY_POINTS).toContain('App.kt');
  });

  test('includes Java entry points', () => {
    expect(ENTRY_POINTS).toContain('Main.java');
    expect(ENTRY_POINTS).toContain('Application.java');
    expect(ENTRY_POINTS).toContain('App.java');
  });
});

describe('EXPORT_PATTERNS integration', () => {
  test('includes kotlin export patterns', () => {
    expect(EXPORT_PATTERNS.kotlin).toBeDefined();
    expect(Array.isArray(EXPORT_PATTERNS.kotlin)).toBe(true);
  });
});

describe('cli-enhancers integration', () => {
  test('SUPPORTED_LANGUAGES includes java and kotlin', () => {
    expect(SUPPORTED_LANGUAGES).toContain('java');
    expect(SUPPORTED_LANGUAGES).toContain('kotlin');
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

// ============================================================================
// java_sysout_debugging
// ============================================================================

describe('java_sysout_debugging', () => {
  const { pattern, exclude } = slopPatterns.java_sysout_debugging;

  test('matches System.out.println()', () => {
    expect(pattern.test('System.out.println("debug value: " + x);')).toBe(true);
  });

  test('matches System.err.println()', () => {
    expect(pattern.test('System.err.println("Error occurred");')).toBe(true);
  });

  test('matches System.out.print() without ln', () => {
    expect(pattern.test('System.out.print("value");')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('        System.out.println(result);')).toBe(true);
  });

  test('does not match Logger calls', () => {
    expect(pattern.test('logger.info("Processing request");')).toBe(false);
  });

  test('does not match log4j calls', () => {
    expect(pattern.test('LOG.debug("Entering method");')).toBe(false);
  });

  test('does not match partial System text', () => {
    expect(pattern.test('// The System should handle this')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
    expect(isFileExcluded('src/test/BarTest.java', exclude)).toBe(true);
  });

  test('excludes example files', () => {
    expect(isFileExcluded('src/examples/Demo.java', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/java/Service.java', exclude)).toBe(false);
    expect(isFileExcluded('lib/Utils.java', exclude)).toBe(false);
  });
});

// ============================================================================
// java_stacktrace_debugging
// ============================================================================

describe('java_stacktrace_debugging', () => {
  const { pattern, exclude } = slopPatterns.java_stacktrace_debugging;

  test('matches e.printStackTrace()', () => {
    expect(pattern.test('e.printStackTrace();')).toBe(true);
  });

  test('matches ex.printStackTrace()', () => {
    expect(pattern.test('ex.printStackTrace();')).toBe(true);
  });

  test('matches exception.printStackTrace()', () => {
    expect(pattern.test('exception.printStackTrace();')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('            e.printStackTrace();')).toBe(true);
  });

  test('does not match printStackTrace with argument', () => {
    expect(pattern.test('e.printStackTrace(System.err);')).toBe(false);
  });

  test('does not match partial method name', () => {
    expect(pattern.test('printStackTraceToLog(e);')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/BarTest.java', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/java/Handler.java', exclude)).toBe(false);
  });
});

// ============================================================================
// java_throw_todo
// ============================================================================

describe('java_throw_todo', () => {
  const { pattern, exclude } = slopPatterns.java_throw_todo;

  test('matches throw new RuntimeException("TODO")', () => {
    expect(pattern.test('throw new RuntimeException("TODO: implement this");')).toBe(true);
  });

  test('matches throw new IllegalStateException("not implemented")', () => {
    expect(pattern.test('throw new IllegalStateException("not implemented");')).toBe(true);
  });

  test('matches throw new IllegalArgumentException("FIXME")', () => {
    expect(pattern.test('throw new IllegalArgumentException("FIXME: validate input");')).toBe(true);
  });

  test('matches case-insensitive TODO', () => {
    expect(pattern.test('throw new RuntimeException("Todo: finish later");')).toBe(true);
  });

  test('matches with HACK marker', () => {
    expect(pattern.test('throw new RuntimeException("HACK: temporary workaround");')).toBe(true);
  });

  test('does not match real error messages', () => {
    expect(pattern.test('throw new RuntimeException("Connection timed out");')).toBe(false);
  });

  test('does not match real IllegalStateException', () => {
    expect(pattern.test('throw new IllegalStateException("Session is closed");')).toBe(false);
  });

  test('does not match IOException', () => {
    expect(pattern.test('throw new IOException("File not found");')).toBe(false);
  });

  test('matches with long text before keyword (within 200-char limit)', () => {
    const padding = 'x'.repeat(180);
    expect(pattern.test(`throw new RuntimeException("${padding} TODO");`)).toBe(true);
  });

  test('does not match when text exceeds 200-char limit', () => {
    const padding = 'x'.repeat(210);
    expect(pattern.test(`throw new RuntimeException("${padding} TODO");`)).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
    expect(isFileExcluded('src/test/FooTest.java', exclude)).toBe(true);
  });
});

// ============================================================================
// java_return_null_todo
// ============================================================================

describe('java_return_null_todo', () => {
  const { pattern, exclude } = slopPatterns.java_return_null_todo;

  test('matches return null; // TODO', () => {
    expect(pattern.test('return null; // TODO')).toBe(true);
  });

  test('matches return null; // FIXME', () => {
    expect(pattern.test('return null; // FIXME: implement this')).toBe(true);
  });

  test('matches return null; // placeholder', () => {
    expect(pattern.test('return null; // placeholder')).toBe(true);
  });

  test('matches return null; // stub', () => {
    expect(pattern.test('return null; // stub implementation')).toBe(true);
  });

  test('matches case-insensitive', () => {
    expect(pattern.test('return null; // todo implement later')).toBe(true);
  });

  test('does not match return null without TODO comment', () => {
    expect(pattern.test('return null;')).toBe(false);
  });

  test('does not match return null with unrelated comment', () => {
    expect(pattern.test('return null; // nothing found')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
  });
});

// ============================================================================
// java_empty_catch
// ============================================================================

describe('java_empty_catch', () => {
  const { pattern, exclude } = slopPatterns.java_empty_catch;

  test('matches catch (Exception e) {}', () => {
    expect(pattern.test('catch (Exception e) {}')).toBe(true);
  });

  test('matches catch (IOException e) {}', () => {
    expect(pattern.test('catch (IOException e) {}')).toBe(true);
  });

  test('matches with whitespace inside braces', () => {
    expect(pattern.test('catch (Exception e) {  }')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    } catch (Exception e) {}')).toBe(true);
  });

  test('does not match catch with logging', () => {
    expect(pattern.test('catch (Exception e) { logger.error("Failed", e); }')).toBe(false);
  });

  test('does not match catch with comment', () => {
    expect(pattern.test('catch (Exception e) { /* intentionally empty */ }')).toBe(false);
  });

  test('does not match catch with rethrow', () => {
    expect(pattern.test('catch (Exception e) { throw e; }')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('ServiceTest.java', exclude)).toBe(true);
    expect(isFileExcluded('src/test/ServiceTest.java', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/java/Service.java', exclude)).toBe(false);
  });
});

// ============================================================================
// java_catch_ignore
// ============================================================================

describe('java_catch_ignore', () => {
  const { pattern, exclude } = slopPatterns.java_catch_ignore;

  test('matches catch with // ignore comment', () => {
    expect(pattern.test('catch (Exception e) { // ignore')).toBe(true);
  });

  test('matches catch with // suppress comment', () => {
    expect(pattern.test('catch (IOException e) { // suppress')).toBe(true);
  });

  test('matches catch with // noop comment', () => {
    expect(pattern.test('catch (Exception e) { // noop')).toBe(true);
  });

  test('matches catch with // intentional comment', () => {
    expect(pattern.test('catch (Exception e) { // intentional')).toBe(true);
  });

  test('matches case-insensitive', () => {
    expect(pattern.test('catch (Exception e) { // IGNORE this error')).toBe(true);
  });

  test('does not match catch with real comment', () => {
    expect(pattern.test('catch (Exception e) { // log and rethrow')).toBe(false);
  });

  test('does not match catch with handling code', () => {
    expect(pattern.test('catch (Exception e) { logger.warn("Failed", e); }')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
  });
});

// ============================================================================
// java_suppress_warnings
// ============================================================================

describe('java_suppress_warnings', () => {
  const { pattern, exclude } = slopPatterns.java_suppress_warnings;

  test('matches @SuppressWarnings("unchecked")', () => {
    expect(pattern.test('@SuppressWarnings("unchecked")')).toBe(true);
  });

  test('matches @SuppressWarnings("deprecation")', () => {
    expect(pattern.test('@SuppressWarnings("deprecation")')).toBe(true);
  });

  test('matches @SuppressWarnings("rawtypes")', () => {
    expect(pattern.test('@SuppressWarnings("rawtypes")')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    @SuppressWarnings("unchecked")')).toBe(true);
  });

  test('does not match @Override', () => {
    expect(pattern.test('@Override')).toBe(false);
  });

  test('does not match @Deprecated', () => {
    expect(pattern.test('@Deprecated')).toBe(false);
  });

  test('does not match @SuppressWarnings without opening quote', () => {
    expect(pattern.test('@SuppressWarnings')).toBe(false);
  });

  test('does not match @SuppressWarnings("serial")', () => {
    expect(pattern.test('@SuppressWarnings("serial")')).toBe(false);
  });

  test('does not match @SuppressWarnings("unused")', () => {
    expect(pattern.test('@SuppressWarnings("unused")')).toBe(false);
  });

  test('does not match @SuppressWarnings("ThreadLocalUsage")', () => {
    expect(pattern.test('@SuppressWarnings("ThreadLocalUsage")')).toBe(false);
  });

  test('does not match @SuppressWarnings("PMD.TooManyMethods")', () => {
    expect(pattern.test('@SuppressWarnings("PMD.TooManyMethods")')).toBe(false);
  });

  test('matches @SuppressWarnings("all")', () => {
    expect(pattern.test('@SuppressWarnings("all")')).toBe(true);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
  });
});

// ============================================================================
// java_raw_type
// ============================================================================

describe('java_raw_type', () => {
  const { pattern, exclude } = slopPatterns.java_raw_type;

  test('matches List items =', () => {
    expect(pattern.test('List items = new ArrayList();')).toBe(true);
  });

  test('matches Map data =', () => {
    expect(pattern.test('Map data = new HashMap();')).toBe(true);
  });

  test('matches Set values;', () => {
    expect(pattern.test('Set values;')).toBe(true);
  });

  test('matches Collection results =', () => {
    expect(pattern.test('Collection results = getAll();')).toBe(true);
  });

  test('matches Iterator iter =', () => {
    expect(pattern.test('Iterator iter = list.iterator();')).toBe(true);
  });

  test('does not match List<String> items', () => {
    expect(pattern.test('List<String> items = new ArrayList<>();')).toBe(false);
  });

  test('does not match Map<String, Integer> data', () => {
    expect(pattern.test('Map<String, Integer> data = new HashMap<>();')).toBe(false);
  });

  test('matches raw types with access modifiers (still raw)', () => {
    // private/static/final List is still a raw type
    expect(pattern.test('private List items;')).toBe(true);
    expect(pattern.test('static List cache;')).toBe(true);
    expect(pattern.test('final List constants;')).toBe(true);
  });

  test('does not match "List" in a comment', () => {
    // Variable name after List is required
    expect(pattern.test('// This is a List of items')).toBe(false);
  });

  test('does not match List.of() static method call', () => {
    expect(pattern.test('List.of(1, 2, 3)')).toBe(false);
  });

  test('does not match List<String> (generic type)', () => {
    expect(pattern.test('List<String> items = new ArrayList<>();')).toBe(false);
  });

  test('does not match compound class names containing collection type', () => {
    // Word boundary prevents matching JWKSet, ResultSet, SourceSet, etc.
    expect(pattern.test('JWKSet jwkSet = new JWKSet(rsaKey);')).toBe(false);
    expect(pattern.test('ResultSet rs = stmt.executeQuery();')).toBe(false);
    expect(pattern.test('SourceSet mainSourceSet = java.getSourceSets();')).toBe(false);
    expect(pattern.test('BitSet bitset = new BitSet();')).toBe(false);
    expect(pattern.test('EntrySet entrySet;')).toBe(false);
    expect(pattern.test('KeySet keySet;')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
  });
});

// ============================================================================
// java_wildcard_catch
// ============================================================================

describe('java_wildcard_catch', () => {
  const { pattern, exclude } = slopPatterns.java_wildcard_catch;

  test('matches catch (Exception e)', () => {
    expect(pattern.test('catch (Exception e) {')).toBe(true);
  });

  test('matches catch (Throwable t)', () => {
    expect(pattern.test('catch (Throwable t) {')).toBe(true);
  });

  test('matches catch (Error e)', () => {
    expect(pattern.test('catch (Error e) {')).toBe(true);
  });

  test('matches with different variable names', () => {
    expect(pattern.test('catch (Exception ex) {')).toBe(true);
  });

  test('does not match catch (IOException e)', () => {
    expect(pattern.test('catch (IOException e) {')).toBe(false);
  });

  test('does not match catch (NullPointerException e)', () => {
    expect(pattern.test('catch (NullPointerException e) {')).toBe(false);
  });

  test('does not match catch (RuntimeException e)', () => {
    expect(pattern.test('catch (RuntimeException e) {')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.java', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/java/Service.java', exclude)).toBe(false);
  });
});

// ============================================================================
// kotlin_println_debugging
// ============================================================================

describe('kotlin_println_debugging', () => {
  const { pattern, exclude } = slopPatterns.kotlin_println_debugging;

  test('matches println("debug")', () => {
    expect(pattern.test('println("value: $x")')).toBe(true);
  });

  test('matches println() with no args', () => {
    expect(pattern.test('println()')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    println("checking here")')).toBe(true);
  });

  test('matches println with variable', () => {
    expect(pattern.test('println(result)')).toBe(true);
  });

  test('does not match fprintln or similar', () => {
    expect(pattern.test('fprintln("test")')).toBe(false);
  });

  test('does not match println preceded by word character (part of identifier)', () => {
    // The lookbehind (?<!\w) prevents matching when println is part of an identifier
    expect(pattern.test('loggerprintln("test")')).toBe(false);
  });

  test('matches object.println() since dot-println is typically debug output', () => {
    // logger.println() is still flagged - dot is not a \w char, and .println() is debug output
    expect(pattern.test('logger.println("test")')).toBe(true);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
    expect(isFileExcluded('src/test/BarTest.kt', exclude)).toBe(true);
  });

  test('excludes example files', () => {
    expect(isFileExcluded('src/examples/Demo.kt', exclude)).toBe(true);
  });

  test('excludes main.kt entry point', () => {
    expect(isFileExcluded('main.kt', exclude)).toBe(true);
    expect(isFileExcluded('Main.kt', exclude)).toBe(true);
  });

  test('excludes Gradle build scripts', () => {
    expect(isFileExcluded('build.gradle.kts', exclude)).toBe(true);
    expect(isFileExcluded('settings.gradle', exclude)).toBe(true);
  });

  test('excludes documentation snippets', () => {
    expect(isFileExcluded('docs/snippets/Example.kt', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/kotlin/Service.kt', exclude)).toBe(false);
  });
});

// ============================================================================
// kotlin_todo_call
// ============================================================================

describe('kotlin_todo_call', () => {
  const { pattern, exclude } = slopPatterns.kotlin_todo_call;

  test('matches TODO()', () => {
    expect(pattern.test('TODO()')).toBe(true);
  });

  test('matches TODO("reason")', () => {
    expect(pattern.test('TODO("Not implemented yet")')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('        TODO("implement later")')).toBe(true);
  });

  test('matches as return expression', () => {
    expect(pattern.test('return TODO("pending")')).toBe(true);
  });

  test('does not match TODO in a comment', () => {
    // Comments don't have TODO followed by (
    expect(pattern.test('// TODO: fix this later')).toBe(false);
  });

  test('does not match todoList variable', () => {
    expect(pattern.test('val todoList = mutableListOf()')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
    expect(isFileExcluded('src/test/BarTest.kt', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/kotlin/Service.kt', exclude)).toBe(false);
  });
});

// ============================================================================
// kotlin_fixme_comment
// ============================================================================

describe('kotlin_fixme_comment', () => {
  const { pattern, exclude } = slopPatterns.kotlin_fixme_comment;

  test('matches // FIXME', () => {
    expect(pattern.test('// FIXME')).toBe(true);
  });

  test('matches // FIXME: description', () => {
    expect(pattern.test('// FIXME: this is broken')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    // FIXME: urgent')).toBe(true);
  });

  test('does not match FIXME in a string', () => {
    expect(pattern.test('val msg = "FIXME"')).toBe(false);
  });

  test('does not match TODO comment', () => {
    expect(pattern.test('// TODO: implement')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
  });
});

// ============================================================================
// kotlin_empty_catch
// ============================================================================

describe('kotlin_empty_catch', () => {
  const { pattern, exclude } = slopPatterns.kotlin_empty_catch;

  test('matches catch (e: Exception) {}', () => {
    expect(pattern.test('catch (e: Exception) {}')).toBe(true);
  });

  test('matches catch (e: IOException) {}', () => {
    expect(pattern.test('catch (e: IOException) {}')).toBe(true);
  });

  test('matches with whitespace inside braces', () => {
    expect(pattern.test('catch (e: Exception) {   }')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    } catch (e: Exception) {}')).toBe(true);
  });

  test('does not match catch with logging', () => {
    expect(pattern.test('catch (e: Exception) { logger.error("Failed", e) }')).toBe(false);
  });

  test('does not match catch with comment', () => {
    expect(pattern.test('catch (e: Exception) { /* intentionally empty */ }')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
    expect(isFileExcluded('src/test/BarTest.kt', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/kotlin/Service.kt', exclude)).toBe(false);
  });
});

// ============================================================================
// kotlin_swallowed_error
// ============================================================================

describe('kotlin_swallowed_error', () => {
  const { pattern, exclude } = slopPatterns.kotlin_swallowed_error;

  test('matches runCatching{}.getOrNull()', () => {
    expect(pattern.test('val result = runCatching{ doSomething() }.getOrNull()')).toBe(true);
  });

  test('matches with whitespace', () => {
    expect(pattern.test('runCatching { parse(input) }.getOrNull()')).toBe(true);
  });

  test('matches with multiline-like content in block', () => {
    expect(pattern.test('runCatching { fetchData(url) }.getOrNull()')).toBe(true);
  });

  test('does not match runCatching{}.getOrElse{}', () => {
    expect(pattern.test('runCatching { parse(input) }.getOrElse { defaultValue }')).toBe(false);
  });

  test('does not match runCatching{}.onFailure{}', () => {
    expect(pattern.test('runCatching { fetch() }.onFailure { log(it) }')).toBe(false);
  });

  test('does not match runCatching{}.getOrThrow()', () => {
    expect(pattern.test('runCatching { parse(x) }.getOrThrow()')).toBe(false);
  });

  test('matches with extra whitespace around dot and method', () => {
    expect(pattern.test('runCatching { doWork() } .  getOrNull()')).toBe(true);
  });

  test('does not match when block contains nested braces (known limitation)', () => {
    // Pattern uses [^}]* which stops at first }. Blocks with nested braces
    // (e.g., if/when statements) won't match. This is acceptable since
    // line-by-line scanning handles most cases and empty_catch covers the rest.
    expect(pattern.test('runCatching { if (x) { foo() } }.getOrNull()')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
  });
});

// ============================================================================
// kotlin_suppress_annotation
// ============================================================================

describe('kotlin_suppress_annotation', () => {
  const { pattern, exclude } = slopPatterns.kotlin_suppress_annotation;

  test('matches @Suppress("UNCHECKED_CAST")', () => {
    expect(pattern.test('@Suppress("UNCHECKED_CAST")')).toBe(true);
  });

  test('matches @Suppress("DEPRECATION")', () => {
    expect(pattern.test('@Suppress("DEPRECATION")')).toBe(true);
  });

  test('matches @Suppress("unused")', () => {
    expect(pattern.test('@Suppress("unused")')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('    @Suppress("UNCHECKED_CAST")')).toBe(true);
  });

  test('does not match @JvmStatic', () => {
    expect(pattern.test('@JvmStatic')).toBe(false);
  });

  test('does not match @Deprecated', () => {
    expect(pattern.test('@Deprecated("use newMethod instead")')).toBe(false);
  });

  test('does not match @Suppress without opening quote', () => {
    expect(pattern.test('@Suppress')).toBe(false);
  });

  test('does not match @Suppress("MagicNumber")', () => {
    expect(pattern.test('@Suppress("MagicNumber")')).toBe(false);
  });

  test('does not match @Suppress("ForbiddenComment")', () => {
    expect(pattern.test('@Suppress("ForbiddenComment")')).toBe(false);
  });

  test('does not match @Suppress("UnstableApiUsage")', () => {
    expect(pattern.test('@Suppress("UnstableApiUsage")')).toBe(false);
  });

  test('does not match @Suppress("EnumEntryName")', () => {
    expect(pattern.test('@Suppress("EnumEntryName")')).toBe(false);
  });

  test('does not match @Suppress("ktlint:standard:function-naming")', () => {
    expect(pattern.test('@Suppress("ktlint:standard:function-naming")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('FooTest.kt', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main/kotlin/Service.kt', exclude)).toBe(false);
  });
});
