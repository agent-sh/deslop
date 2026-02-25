/**
 * Tests for C and C++ slop detection patterns
 * Covers all 7 shared C patterns and 3 C++-only patterns
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
  test('hasLanguage("c") returns true', () => {
    expect(hasLanguage('c')).toBe(true);
  });

  test('getPatternsForLanguageOnly("c") returns exactly 7 patterns', () => {
    const cOnly = getPatternsForLanguageOnly('c');
    expect(Object.keys(cOnly)).toHaveLength(7);
  });

  test('all 7 C pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('c'));
    expect(names).toContain('c_printf_debugging');
    expect(names).toContain('c_ifdef_debug_block');
    expect(names).toContain('c_placeholder_todo');
    expect(names).toContain('c_pragma_warning_disable');
    expect(names).toContain('c_goto_usage');
    expect(names).toContain('c_hardcoded_credential_path');
    expect(names).toContain('c_magic_number_cast');
  });

  test('getPatternsForLanguage("c") includes universal patterns', () => {
    const cAll = getPatternsForLanguage('c');
    const cOnly = getPatternsForLanguageOnly('c');
    expect(Object.keys(cAll).length).toBeGreaterThan(Object.keys(cOnly).length);
  });

  test('all C patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('c'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'c');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// Integration tests - C++
// ============================================================================

describe('C++ language integration', () => {
  test('hasLanguage("cpp") returns true', () => {
    expect(hasLanguage('cpp')).toBe(true);
  });

  test('getPatternsForLanguageOnly("cpp") returns exactly 3 patterns', () => {
    const cppOnly = getPatternsForLanguageOnly('cpp');
    expect(Object.keys(cppOnly)).toHaveLength(3);
  });

  test('all 3 C++ pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('cpp'));
    expect(names).toContain('cpp_cout_debugging');
    expect(names).toContain('cpp_throw_not_implemented');
    expect(names).toContain('cpp_empty_catch');
  });

  test('getPatternsForLanguage("cpp") includes universal patterns', () => {
    const cppAll = getPatternsForLanguage('cpp');
    const cppOnly = getPatternsForLanguageOnly('cpp');
    expect(Object.keys(cppAll).length).toBeGreaterThan(Object.keys(cppOnly).length);
  });

  test('all C++ patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('cpp'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'cpp');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// c_printf_debugging
// ============================================================================

describe('c_printf_debugging', () => {
  const { pattern, exclude } = slopPatterns.c_printf_debugging;

  test('matches printf("DEBUG ...") with debug marker', () => {
    expect(pattern.test('printf("DEBUG: value is %d\\n", x);')).toBe(true);
  });

  test('matches fprintf(stderr, "TRACE ...") with trace marker', () => {
    expect(pattern.test('fprintf(stderr, "TRACE entering func");')).toBe(true);
  });

  test('matches printf("HERE") marker', () => {
    expect(pattern.test("printf('HERE');")).toBe(true);
  });

  test('case insensitive - matches printf("debug")', () => {
    expect(pattern.test('printf("debug: x=%d", x);')).toBe(true);
  });

  test('does not match regular printf("Hello")', () => {
    expect(pattern.test('printf("Hello, world!\\n");')).toBe(false);
  });

  test('does not match printf with format string', () => {
    expect(pattern.test('printf("Value: %d\\n", count);')).toBe(false);
  });

  test('does not match printf("Error: ...")', () => {
    expect(pattern.test('printf("Error: file not found\\n");')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.c', exclude)).toBe(true);
    expect(isFileExcluded('parser_test.cpp', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/unit.c', exclude)).toBe(true);
    expect(isFileExcluded('project/test/main.c', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.c', exclude)).toBe(false);
    expect(isFileExcluded('lib/utils.c', exclude)).toBe(false);
  });
});

// ============================================================================
// c_ifdef_debug_block
// ============================================================================

describe('c_ifdef_debug_block', () => {
  const { pattern, exclude } = slopPatterns.c_ifdef_debug_block;

  test('matches #ifdef DEBUG', () => {
    expect(pattern.test('#ifdef DEBUG')).toBe(true);
  });

  test('matches #if 0', () => {
    expect(pattern.test('#if 0')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('  #ifdef DEBUG')).toBe(true);
  });

  test('matches with space after #', () => {
    expect(pattern.test('# ifdef DEBUG')).toBe(true);
  });

  test('does not match #ifdef _WIN32', () => {
    expect(pattern.test('#ifdef _WIN32')).toBe(false);
  });

  test('does not match #ifdef HAVE_CONFIG_H', () => {
    expect(pattern.test('#ifdef HAVE_CONFIG_H')).toBe(false);
  });

  test('does not match #if 1', () => {
    expect(pattern.test('#if 1')).toBe(false);
  });

  test('does not match #ifndef DEBUG', () => {
    expect(pattern.test('#ifndef DEBUG')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('main_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_placeholder_todo
// ============================================================================

describe('c_placeholder_todo', () => {
  const { pattern, exclude } = slopPatterns.c_placeholder_todo;

  test('matches assert(false && "not implemented")', () => {
    expect(pattern.test('assert(false && "not implemented");')).toBe(true);
  });

  test('matches assert(0 && "TODO: implement")', () => {
    expect(pattern.test('assert(0 && "TODO: implement this");')).toBe(true);
  });

  test('matches case-insensitive', () => {
    expect(pattern.test('assert(false && "Not Implemented yet");')).toBe(true);
  });

  test('does not match assert(ptr != NULL)', () => {
    expect(pattern.test('assert(ptr != NULL);')).toBe(false);
  });

  test('does not match assert(count > 0)', () => {
    expect(pattern.test('assert(count > 0);')).toBe(false);
  });

  test('does not match regular assert(false) without message', () => {
    expect(pattern.test('assert(false);')).toBe(false);
  });

  test('matches with long text before keyword (within 200-char limit)', () => {
    const padding = 'x'.repeat(180);
    expect(pattern.test(`assert(false && "${padding} not implemented");`)).toBe(true);
  });

  test('does not match when text exceeds 200-char limit', () => {
    const padding = 'x'.repeat(210);
    expect(pattern.test(`assert(false && "${padding} not implemented");`)).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.c', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_pragma_warning_disable
// ============================================================================

describe('c_pragma_warning_disable', () => {
  const { pattern, exclude } = slopPatterns.c_pragma_warning_disable;

  test('matches MSVC #pragma warning(disable:...)', () => {
    expect(pattern.test('#pragma warning(disable: 4996)')).toBe(true);
  });

  test('matches GCC diagnostic ignored', () => {
    expect(pattern.test('#pragma GCC diagnostic ignored "-Wunused-variable"')).toBe(true);
  });

  test('matches clang diagnostic ignored', () => {
    expect(pattern.test('#pragma clang diagnostic ignored "-Wdeprecated"')).toBe(true);
  });

  test('matches with leading whitespace', () => {
    expect(pattern.test('  #pragma warning(disable: 4996)')).toBe(true);
  });

  test('does not match #pragma once', () => {
    expect(pattern.test('#pragma once')).toBe(false);
  });

  test('does not match #pragma pack', () => {
    expect(pattern.test('#pragma pack(push, 1)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_goto_usage
// ============================================================================

describe('c_goto_usage', () => {
  const { pattern, exclude } = slopPatterns.c_goto_usage;

  test('matches goto label;', () => {
    expect(pattern.test('goto cleanup;')).toBe(true);
  });

  test('matches goto with whitespace', () => {
    expect(pattern.test('    goto error_handler;')).toBe(true);
  });

  test('does not match goto in comments', () => {
    // The pattern matches the word 'goto' followed by identifier and semicolon
    // A comment line would still match if it has exact format, which is expected
    // since commented_code pattern handles that separately
    expect(pattern.test('// avoid goto')).toBe(false);
  });

  test('does not match "goto" as part of a string', () => {
    // Without semicolon it should not match
    expect(pattern.test('"goto is considered harmful"')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('main_test.c', exclude)).toBe(true);
    expect(isFileExcluded('project/test/cleanup.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_hardcoded_credential_path
// ============================================================================

describe('c_hardcoded_credential_path', () => {
  const { pattern, exclude } = slopPatterns.c_hardcoded_credential_path;

  test('matches "/etc/shadow"', () => {
    expect(pattern.test('fopen("/etc/shadow", "r");')).toBe(true);
  });

  test('matches "/etc/passwd"', () => {
    expect(pattern.test('path = "/etc/passwd";')).toBe(true);
  });

  test('matches SSH private key path', () => {
    expect(pattern.test('key = "/home/user/.ssh/id_rsa";')).toBe(true);
  });

  test('matches ed25519 key path', () => {
    expect(pattern.test('key = "/home/deploy/.ssh/id_ed25519";')).toBe(true);
  });

  test('matches authorized_keys path', () => {
    expect(pattern.test('auth = "/home/admin/.ssh/authorized_keys";')).toBe(true);
  });

  test('matches SSL private key directory', () => {
    expect(pattern.test('cert = "/etc/ssl/private";')).toBe(true);
  });

  test('does not match regular /etc paths', () => {
    expect(pattern.test('conf = "/etc/hostname";')).toBe(false);
  });

  test('does not match /home without .ssh', () => {
    expect(pattern.test('dir = "/home/user/documents";')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('security_test.c', exclude)).toBe(true);
  });

  test('severity is critical', () => {
    expect(slopPatterns.c_hardcoded_credential_path.severity).toBe('critical');
  });
});

// ============================================================================
// c_magic_number_cast
// ============================================================================

describe('c_magic_number_cast', () => {
  const { pattern, exclude } = slopPatterns.c_magic_number_cast;

  test('matches (void *)0xDEADBEEF', () => {
    expect(pattern.test('ptr = (void *)0xDEADBEEF;')).toBe(true);
  });

  test('matches (char *)0x40000000', () => {
    expect(pattern.test('buf = (char *)0x40000000;')).toBe(true);
  });

  test('matches (int *)0xFFFF0000', () => {
    expect(pattern.test('reg = (int *)0xFFFF0000;')).toBe(true);
  });

  test('matches (unsigned *)0xABCD1234', () => {
    expect(pattern.test('val = (unsigned *)0xABCD1234;')).toBe(true);
  });

  test('does not match short hex values (void *)0xFF', () => {
    // Less than 4 hex digits - not a magic number cast
    expect(pattern.test('(void *)0xFF')).toBe(false);
  });

  test('does not match regular hex assignment', () => {
    expect(pattern.test('int mask = 0xDEADBEEF;')).toBe(false);
  });

  test('does not match NULL cast', () => {
    expect(pattern.test('ptr = (void *)NULL;')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('memory_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// cpp_cout_debugging
// ============================================================================

describe('cpp_cout_debugging', () => {
  const { pattern, exclude } = slopPatterns.cpp_cout_debugging;

  test('matches std::cout <<', () => {
    expect(pattern.test('std::cout << "value: " << x << std::endl;')).toBe(true);
  });

  test('matches std::cerr <<', () => {
    expect(pattern.test('std::cerr << "error: " << msg;')).toBe(true);
  });

  test('does not match cout without std:: prefix', () => {
    // Using namespace std is a separate concern
    expect(pattern.test('cout << "hello";')).toBe(false);
  });

  test('does not match cerr without std:: prefix', () => {
    expect(pattern.test('cerr << "error";')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.cpp', exclude)).toBe(true);
    expect(isFileExcluded('parser_test.cc', exclude)).toBe(true);
  });

  test('excludes example files', () => {
    expect(isFileExcluded('project/examples/demo.cpp', exclude)).toBe(true);
  });

  test('excludes main.cpp (CLI output is legitimate)', () => {
    expect(isFileExcluded('src/main.cpp', exclude)).toBe(true);
    expect(isFileExcluded('project/main.cc', exclude)).toBe(true);
  });

  test('does not exclude regular library source files', () => {
    expect(isFileExcluded('src/parser.cpp', exclude)).toBe(false);
    expect(isFileExcluded('lib/utils.cc', exclude)).toBe(false);
  });
});

// ============================================================================
// cpp_throw_not_implemented
// ============================================================================

describe('cpp_throw_not_implemented', () => {
  const { pattern, exclude } = slopPatterns.cpp_throw_not_implemented;

  test('matches throw runtime_error("not implemented")', () => {
    expect(pattern.test('throw std::runtime_error("not implemented");')).toBe(true);
  });

  test('matches throw logic_error("TODO: implement")', () => {
    expect(pattern.test('throw std::logic_error("TODO: implement this");')).toBe(true);
  });

  test('matches without std:: prefix', () => {
    expect(pattern.test('throw runtime_error("not implemented");')).toBe(true);
  });

  test('matches domain_error with implement', () => {
    expect(pattern.test('throw std::domain_error("implement me");')).toBe(true);
  });

  test('matches case insensitive', () => {
    expect(pattern.test('throw std::runtime_error("Not Implemented");')).toBe(true);
  });

  test('does not match throw with real error message', () => {
    expect(pattern.test('throw std::runtime_error("Connection refused");')).toBe(false);
  });

  test('does not match throw with variable', () => {
    expect(pattern.test('throw std::runtime_error(error_msg);')).toBe(false);
  });

  test('matches with long text before keyword (within 200-char limit)', () => {
    const padding = 'x'.repeat(180);
    expect(pattern.test(`throw std::runtime_error("${padding} not implemented");`)).toBe(true);
  });

  test('does not match when text exceeds 200-char limit', () => {
    const padding = 'x'.repeat(210);
    expect(pattern.test(`throw std::runtime_error("${padding} not implemented");`)).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.cpp', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.cpp', exclude)).toBe(true);
  });
});

// ============================================================================
// cpp_empty_catch
// ============================================================================

describe('cpp_empty_catch', () => {
  const { pattern, exclude } = slopPatterns.cpp_empty_catch;

  test('matches catch (...) {}', () => {
    expect(pattern.test('catch (...) {}')).toBe(true);
  });

  test('matches catch (std::exception& e) {}', () => {
    expect(pattern.test('catch (std::exception& e) {}')).toBe(true);
  });

  test('matches catch (const std::exception& e) {}', () => {
    expect(pattern.test('catch (const std::exception& e) {}')).toBe(true);
  });

  test('does not match catch with handler body', () => {
    expect(pattern.test('catch (std::exception& e) { log(e); }')).toBe(false);
  });

  test('does not match catch with comment body', () => {
    expect(pattern.test('catch (...) { /* intentionally empty */ }')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.cpp', exclude)).toBe(true);
    expect(isFileExcluded('parser_test.cc', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.cpp', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.cpp', exclude)).toBe(false);
    expect(isFileExcluded('lib/network.cc', exclude)).toBe(false);
  });
});
