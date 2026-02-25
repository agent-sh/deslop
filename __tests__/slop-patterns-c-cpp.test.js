/**
 * Tests for C and C++ slop detection patterns
 * Covers 16 C patterns (13 active, 3 disabled) and 6 C++-only patterns
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

  test('getPatternsForLanguageOnly("c") returns exactly 16 patterns', () => {
    const cOnly = getPatternsForLanguageOnly('c');
    expect(Object.keys(cOnly)).toHaveLength(16);
  });

  test('all 16 C pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('c'));
    expect(names).toContain('c_printf_debugging');
    expect(names).toContain('c_ifdef_debug_block');
    expect(names).toContain('c_placeholder_todo');
    expect(names).toContain('c_pragma_warning_disable');
    expect(names).toContain('c_goto_usage');
    expect(names).toContain('c_hardcoded_credential_path');
    expect(names).toContain('c_magic_number_cast');
    expect(names).toContain('c_sprintf_usage');
    expect(names).toContain('c_strcpy_usage');
    expect(names).toContain('c_unsafe_atoi');
    expect(names).toContain('c_hardcoded_ip');
    expect(names).toContain('c_hardcoded_debug_path');
    expect(names).toContain('c_return_avoid_warning');
    expect(names).toContain('c_debug_fprintf_conditional');
    expect(names).toContain('c_unchecked_malloc');
    expect(names).toContain('c_todo_stub_function');
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

  test('getPatternsForLanguageOnly("cpp") returns exactly 6 patterns', () => {
    const cppOnly = getPatternsForLanguageOnly('cpp');
    expect(Object.keys(cppOnly)).toHaveLength(6);
  });

  test('all 6 C++ pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('cpp'));
    expect(names).toContain('cpp_cout_debugging');
    expect(names).toContain('cpp_throw_not_implemented');
    expect(names).toContain('cpp_empty_catch');
    expect(names).toContain('cpp_raw_new_delete');
    expect(names).toContain('cpp_c_style_cast');
    expect(names).toContain('cpp_fprintf_stderr');
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

  test('excludes vendored deps', () => {
    expect(isFileExcluded('deps/jemalloc/include/internal.h', exclude)).toBe(true);
    expect(isFileExcluded('vendor/zlib/zutil.h', exclude)).toBe(true);
    expect(isFileExcluded('third_party/libc/string.h', exclude)).toBe(true);
  });
});

// ============================================================================
// c_goto_usage
// ============================================================================

describe('c_goto_usage', () => {
  test('pattern is disabled (null) - goto is idiomatic C', () => {
    expect(slopPatterns.c_goto_usage.pattern).toBeNull();
  });

  test('still registered as a C language pattern', () => {
    expect(slopPatterns.c_goto_usage.language).toBe('c');
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

// ============================================================================
// c_sprintf_usage
// ============================================================================

describe('c_sprintf_usage', () => {
  const { pattern, exclude } = slopPatterns.c_sprintf_usage;

  test('matches sprintf( call', () => {
    expect(pattern.test('sprintf(buf, "%s:%d", host, port);')).toBe(true);
  });

  test('matches sprintf with space before paren', () => {
    expect(pattern.test('sprintf (buffer, "%d", value);')).toBe(true);
  });

  test('does not match snprintf', () => {
    expect(pattern.test('snprintf(buf, sizeof(buf), "%s", str);')).toBe(false);
  });

  test('does not match fprintf', () => {
    expect(pattern.test('fprintf(stderr, "error");')).toBe(false);
  });

  test('excludes test files and vendor dirs', () => {
    expect(isFileExcluded('parser_test.c', exclude)).toBe(true);
    expect(isFileExcluded('deps/zlib/util.c', exclude)).toBe(true);
    expect(isFileExcluded('vendor/lz4/lz4.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_strcpy_usage
// ============================================================================

describe('c_strcpy_usage', () => {
  const { pattern, exclude } = slopPatterns.c_strcpy_usage;

  test('matches strcpy( call', () => {
    expect(pattern.test('strcpy(dest, src);')).toBe(true);
  });

  test('matches strcpy with space before paren', () => {
    expect(pattern.test('strcpy (buffer, input);')).toBe(true);
  });

  test('does not match strncpy', () => {
    expect(pattern.test('strncpy(dest, src, sizeof(dest));')).toBe(false);
  });

  test('does not match strlcpy', () => {
    expect(pattern.test('strlcpy(dest, src, sizeof(dest));')).toBe(false);
  });

  test('excludes test files and deps dirs', () => {
    expect(isFileExcluded('copy_test.c', exclude)).toBe(true);
    expect(isFileExcluded('deps/http-parser/http_parser.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_unsafe_atoi
// ============================================================================

describe('c_unsafe_atoi', () => {
  const { pattern, exclude } = slopPatterns.c_unsafe_atoi;

  test('matches atoi( call', () => {
    expect(pattern.test('int port = atoi(argv[1]);')).toBe(true);
  });

  test('matches atol( call', () => {
    expect(pattern.test('long val = atol(str);')).toBe(true);
  });

  test('matches atof( call', () => {
    expect(pattern.test('double d = atof(input);')).toBe(true);
  });

  test('does not match strtol', () => {
    expect(pattern.test('long val = strtol(str, NULL, 10);')).toBe(false);
  });

  test('does not match strtod', () => {
    expect(pattern.test('double d = strtod(input, NULL);')).toBe(false);
  });

  test('excludes vendor dirs', () => {
    expect(isFileExcluded('vendor/lib/parse.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_hardcoded_ip
// ============================================================================

describe('c_hardcoded_ip', () => {
  const { pattern, exclude } = slopPatterns.c_hardcoded_ip;

  test('matches "127.0.0.1"', () => {
    expect(pattern.test('bind("127.0.0.1", port);')).toBe(true);
  });

  test('matches "0.0.0.0"', () => {
    expect(pattern.test('addr = "0.0.0.0";')).toBe(true);
  });

  test('matches "localhost"', () => {
    expect(pattern.test("connect('localhost');")).toBe(true);
  });

  test('does not match IP in a comment without quotes', () => {
    expect(pattern.test('// connect to 127.0.0.1')).toBe(false);
  });

  test('does not match other IP addresses', () => {
    expect(pattern.test('"192.168.1.1"')).toBe(false);
  });

  test('excludes test and example dirs', () => {
    expect(isFileExcluded('net_test.c', exclude)).toBe(true);
    expect(isFileExcluded('project/examples/client.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_hardcoded_debug_path
// ============================================================================

describe('c_hardcoded_debug_path', () => {
  const { pattern, exclude } = slopPatterns.c_hardcoded_debug_path;

  test('matches "/tmp/debug.log"', () => {
    expect(pattern.test('fopen("/tmp/debug.log", "w");')).toBe(true);
  });

  test('matches "/tmp/output.txt"', () => {
    expect(pattern.test('path = "/tmp/output.txt";')).toBe(true);
  });

  test('does not match /tmp/ without filename', () => {
    expect(pattern.test('dir = "/tmp/";')).toBe(false);
  });

  test('does not match /var/log path', () => {
    expect(pattern.test('path = "/var/log/app.log";')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('io_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_return_avoid_warning
// ============================================================================

describe('c_return_avoid_warning', () => {
  const { pattern, exclude } = slopPatterns.c_return_avoid_warning;

  test('matches return with "avoid warning" comment', () => {
    expect(pattern.test('return 0; /* avoid unused warning */')).toBe(true);
  });

  test('matches assignment with "suppress warning" comment', () => {
    expect(pattern.test('= 0; /* suppress warning about unused */')).toBe(true);
  });

  test('matches return NULL with "silence warning" comment', () => {
    expect(pattern.test('return NULL; /* silence compiler warning */')).toBe(true);
  });

  test('does not match normal return without warning comment', () => {
    expect(pattern.test('return 0;')).toBe(false);
  });

  test('does not match return with unrelated comment', () => {
    expect(pattern.test('return -1; /* error case */')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('util_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_debug_fprintf_conditional
// ============================================================================

describe('c_debug_fprintf_conditional', () => {
  const { pattern, exclude } = slopPatterns.c_debug_fprintf_conditional;

  test('matches if (debug) fprintf(...)', () => {
    expect(pattern.test('if (debug) fprintf(stderr, "val=%d", x);')).toBe(true);
  });

  test('matches if (verbose) printf(...)', () => {
    expect(pattern.test('if (verbose) printf("info: %s\\n", msg);')).toBe(true);
  });

  test('matches if (is_debug) { fprintf(...)', () => {
    expect(pattern.test('if (is_debug) { fprintf(stderr, "trace");')).toBe(true);
  });

  test('matches if (trace_enabled) printf(...)', () => {
    expect(pattern.test('if (trace_enabled) printf("entering func");')).toBe(true);
  });

  test('does not match if (ready) printf(...)', () => {
    expect(pattern.test('if (ready) printf("Starting server\\n");')).toBe(false);
  });

  test('does not match if (count > 0) fprintf(...)', () => {
    expect(pattern.test('if (count > 0) fprintf(out, "results");')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('log_test.c', exclude)).toBe(true);
  });
});

// ============================================================================
// c_unchecked_malloc (multi-pass)
// ============================================================================

describe('c_unchecked_malloc', () => {
  test('pattern is null (requires multi-pass analysis)', () => {
    expect(slopPatterns.c_unchecked_malloc.pattern).toBeNull();
  });

  test('requiresMultiPass is true', () => {
    expect(slopPatterns.c_unchecked_malloc.requiresMultiPass).toBe(true);
  });

  test('registered as a C language pattern', () => {
    expect(slopPatterns.c_unchecked_malloc.language).toBe('c');
  });

  test('severity is medium', () => {
    expect(slopPatterns.c_unchecked_malloc.severity).toBe('medium');
  });
});

// ============================================================================
// c_todo_stub_function (multi-pass)
// ============================================================================

describe('c_todo_stub_function', () => {
  test('pattern is null (requires multi-pass analysis)', () => {
    expect(slopPatterns.c_todo_stub_function.pattern).toBeNull();
  });

  test('requiresMultiPass is true', () => {
    expect(slopPatterns.c_todo_stub_function.requiresMultiPass).toBe(true);
  });

  test('registered as a C language pattern', () => {
    expect(slopPatterns.c_todo_stub_function.language).toBe('c');
  });

  test('severity is high', () => {
    expect(slopPatterns.c_todo_stub_function.severity).toBe('high');
  });
});

// ============================================================================
// cpp_raw_new_delete
// ============================================================================

describe('cpp_raw_new_delete', () => {
  const { pattern, exclude } = slopPatterns.cpp_raw_new_delete;

  test('matches new MyClass()', () => {
    expect(pattern.test('auto p = new MyClass();')).toBe(true);
  });

  test('matches new int[10]', () => {
    expect(pattern.test('int* arr = new int[10];')).toBe(true);
  });

  test('matches delete ptr', () => {
    expect(pattern.test('delete ptr;')).toBe(true);
  });

  test('does not match "new" in a string', () => {
    expect(pattern.test('"create a new object"')).toBe(false);
  });

  test('does not match std::make_unique', () => {
    expect(pattern.test('auto p = std::make_unique<MyClass>();')).toBe(false);
  });

  test('excludes test files and deps', () => {
    expect(isFileExcluded('alloc_test.cpp', exclude)).toBe(true);
    expect(isFileExcluded('deps/boost/shared.cpp', exclude)).toBe(true);
  });
});

// ============================================================================
// cpp_c_style_cast
// ============================================================================

describe('cpp_c_style_cast', () => {
  const { pattern, exclude } = slopPatterns.cpp_c_style_cast;

  test('matches (void *) cast', () => {
    expect(pattern.test('ptr = (void *)data;')).toBe(true);
  });

  test('matches (char *) cast', () => {
    expect(pattern.test('str = (char *)buf;')).toBe(true);
  });

  test('matches (const int *) cast', () => {
    expect(pattern.test('p = (const int *)raw;')).toBe(true);
  });

  test('matches (uint32_t *) cast', () => {
    expect(pattern.test('val = (uint32_t *)addr;')).toBe(true);
  });

  test('matches (unsigned char *) cast', () => {
    expect(pattern.test('bytes = (unsigned char *)input;')).toBe(true);
  });

  test('does not match static_cast', () => {
    expect(pattern.test('p = static_cast<void*>(data);')).toBe(false);
  });

  test('does not match reinterpret_cast', () => {
    expect(pattern.test('p = reinterpret_cast<char*>(buf);')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('cast_test.cpp', exclude)).toBe(true);
  });
});

// ============================================================================
// cpp_fprintf_stderr
// ============================================================================

describe('cpp_fprintf_stderr', () => {
  const { pattern, exclude } = slopPatterns.cpp_fprintf_stderr;

  test('matches fprintf(stderr, ...)', () => {
    expect(pattern.test('fprintf(stderr, "error: %s\\n", msg);')).toBe(true);
  });

  test('matches fprintf( stderr , ...) with extra spaces', () => {
    expect(pattern.test('fprintf( stderr , "failed");')).toBe(true);
  });

  test('does not match fprintf(stdout, ...)', () => {
    expect(pattern.test('fprintf(stdout, "output");')).toBe(false);
  });

  test('does not match fprintf to file', () => {
    expect(pattern.test('fprintf(logfile, "msg");')).toBe(false);
  });

  test('excludes test files, examples, and main files', () => {
    expect(isFileExcluded('error_test.cpp', exclude)).toBe(true);
    expect(isFileExcluded('project/examples/demo.cpp', exclude)).toBe(true);
    expect(isFileExcluded('src/main.cpp', exclude)).toBe(true);
    expect(isFileExcluded('app/main.cc', exclude)).toBe(true);
  });

  test('does not exclude regular library source files', () => {
    expect(isFileExcluded('src/network.cpp', exclude)).toBe(false);
    expect(isFileExcluded('lib/protocol.cc', exclude)).toBe(false);
  });
});
