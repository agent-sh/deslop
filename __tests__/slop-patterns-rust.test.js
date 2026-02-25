/**
 * Tests for Rust slop detection patterns
 * Covers all 10 Rust-specific patterns (4 existing + 6 new)
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

describe('Rust language integration', () => {
  test('hasLanguage("rust") returns true', () => {
    expect(hasLanguage('rust')).toBe(true);
  });

  test('getPatternsForLanguageOnly("rust") returns exactly 10 patterns', () => {
    const rustOnly = getPatternsForLanguageOnly('rust');
    expect(Object.keys(rustOnly)).toHaveLength(10);
  });

  test('getPatternsForLanguage("rust") includes universal patterns', () => {
    const rustAll = getPatternsForLanguage('rust');
    const rustOnly = getPatternsForLanguageOnly('rust');
    expect(Object.keys(rustAll).length).toBeGreaterThan(Object.keys(rustOnly).length);
  });

  test('all Rust patterns have required fields', () => {
    const rustPatterns = getPatternsForLanguageOnly('rust');
    for (const [name, pattern] of Object.entries(rustPatterns)) {
      expect(pattern).toHaveProperty('pattern');
      expect(pattern).toHaveProperty('exclude');
      expect(pattern).toHaveProperty('severity');
      expect(pattern).toHaveProperty('autoFix');
      expect(pattern).toHaveProperty('language', 'rust');
      expect(pattern).toHaveProperty('description');
      expect(typeof pattern.description).toBe('string');
      expect(Array.isArray(pattern.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// Existing pattern: rust_debugging
// ============================================================================

describe('rust_debugging', () => {
  const { pattern, exclude } = slopPatterns.rust_debugging;

  test('matches println!()', () => {
    expect(pattern.test('println!("value: {}", x);')).toBe(true);
  });

  test('matches dbg!()', () => {
    expect(pattern.test('dbg!(my_value);')).toBe(true);
  });

  test('matches eprintln!()', () => {
    expect(pattern.test('eprintln!("error: {}", e);')).toBe(true);
  });

  test('does not match print! without ln', () => {
    expect(pattern.test('print!("no newline")')).toBe(false);
  });

  test('does not match format!()', () => {
    expect(pattern.test('let s = format!("hello {}", name);')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('my_module_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('my_module_tests.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/main.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// Existing pattern: placeholder_todo_rust
// ============================================================================

describe('placeholder_todo_rust', () => {
  const { pattern, exclude } = slopPatterns.placeholder_todo_rust;

  test('matches todo!()', () => {
    expect(pattern.test('todo!("implement later")')).toBe(true);
  });

  test('matches unimplemented!()', () => {
    expect(pattern.test('unimplemented!("not yet")')).toBe(true);
  });

  test('matches todo!() without message', () => {
    expect(pattern.test('todo!()')).toBe(true);
  });

  test('does not match todo in comments', () => {
    expect(pattern.test('// todo: fix this later')).toBe(false);
  });

  test('excludes test files and test directories', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/integration.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// Existing pattern: placeholder_panic_todo_rust
// ============================================================================

describe('placeholder_panic_todo_rust', () => {
  const { pattern, exclude } = slopPatterns.placeholder_panic_todo_rust;

  test('matches panic!("TODO: ...")', () => {
    expect(pattern.test('panic!("TODO: implement this")')).toBe(true);
  });

  test('matches panic!("implement later")', () => {
    expect(pattern.test('panic!("implement error handling")')).toBe(true);
  });

  test('does not match panic! without TODO/implement', () => {
    expect(pattern.test('panic!("invalid state: {}", state)')).toBe(false);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/unit.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// Existing pattern: rust_bare_unwrap
// ============================================================================

describe('rust_bare_unwrap', () => {
  const { pattern, exclude } = slopPatterns.rust_bare_unwrap;

  test('matches .unwrap()', () => {
    expect(pattern.test('let val = result.unwrap();')).toBe(true);
  });

  test('matches .unwrap() with spaces', () => {
    expect(pattern.test('result.unwrap( )')).toBe(true);
  });

  test('does not match .unwrap_or()', () => {
    expect(pattern.test('result.unwrap_or(default)')).toBe(false);
  });

  test('does not match .unwrap_or_default()', () => {
    expect(pattern.test('result.unwrap_or_default()')).toBe(false);
  });

  test('does not match .unwrap_or_else()', () => {
    expect(pattern.test('result.unwrap_or_else(|| 0)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('parser_tests.rs', exclude)).toBe(true);
  });

  test('excludes examples and benchmarks', () => {
    // Note: **/examples/** glob requires a path prefix before "examples/"
    expect(isFileExcluded('crate/examples/basic.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/perf.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// New pattern: rust_log_debug
// ============================================================================

describe('rust_log_debug', () => {
  const { pattern, exclude } = slopPatterns.rust_log_debug;

  test('matches log::debug!()', () => {
    expect(pattern.test('log::debug!("entering function");')).toBe(true);
  });

  test('matches log::trace!()', () => {
    expect(pattern.test('log::trace!("detailed trace info");')).toBe(true);
  });

  test('does not match log::info!()', () => {
    expect(pattern.test('log::info!("server started");')).toBe(false);
  });

  test('does not match log::warn!()', () => {
    expect(pattern.test('log::warn!("deprecated feature");')).toBe(false);
  });

  test('does not match log::error!()', () => {
    expect(pattern.test('log::error!("connection failed");')).toBe(false);
  });

  test('does not match debug as variable name', () => {
    expect(pattern.test('let debug = true;')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('parser_tests.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/integration.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/lib.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// New pattern: rust_empty_match_arm
// ============================================================================

describe('rust_empty_match_arm', () => {
  const { pattern, exclude } = slopPatterns.rust_empty_match_arm;

  test('matches Err(e) => {}', () => {
    expect(pattern.test('Err(e) => {}')).toBe(true);
  });

  test('matches Err(_) => {}', () => {
    expect(pattern.test('Err(_) => {}')).toBe(true);
  });

  test('matches Err(err) => {}', () => {
    expect(pattern.test('Err(err) => {}')).toBe(true);
  });

  test('matches Err(e) => ()', () => {
    expect(pattern.test('Err(e) => ()')).toBe(true);
  });

  test('matches with spacing', () => {
    expect(pattern.test('Err( _ ) => { }')).toBe(true);
  });

  test('does not match Err with handler body', () => {
    expect(pattern.test('Err(e) => { log::error!("failed: {}", e); }')).toBe(false);
  });

  test('does not match Err with return', () => {
    expect(pattern.test('Err(e) => { return Err(e); }')).toBe(false);
  });

  test('scope is limited to Err - does not match Some(_) => {}', () => {
    // Pattern intentionally only targets Err match arms (error swallowing)
    expect(pattern.test('Some(_) => {}')).toBe(false);
    expect(pattern.test('None => {}')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// New pattern: rust_unnecessary_clone
// ============================================================================

describe('rust_unnecessary_clone', () => {
  const { pattern, exclude } = slopPatterns.rust_unnecessary_clone;

  test('matches .clone()', () => {
    expect(pattern.test('let copy = value.clone();')).toBe(true);
  });

  test('matches .clone() with spaces', () => {
    expect(pattern.test('value.clone( )')).toBe(true);
  });

  test('matches .clone() in chained call', () => {
    expect(pattern.test('items.clone().iter()')).toBe(true);
  });

  test('does not match clone_from', () => {
    expect(pattern.test('value.clone_from(&other)')).toBe(false);
  });

  test('does not match Clone trait reference', () => {
    expect(pattern.test('impl Clone for MyStruct')).toBe(false);
  });

  test('does not match #[derive(Clone)]', () => {
    expect(pattern.test('#[derive(Clone)]')).toBe(false);
  });

  test('excludes test files and benchmarks', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/throughput.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// New pattern: rust_unsafe_block
// ============================================================================

describe('rust_unsafe_block', () => {
  const { pattern, exclude } = slopPatterns.rust_unsafe_block;

  test('matches unsafe {', () => {
    expect(pattern.test('unsafe {')).toBe(true);
  });

  test('matches unsafe{', () => {
    expect(pattern.test('unsafe{')).toBe(true);
  });

  test('matches unsafe with multiple spaces', () => {
    expect(pattern.test('unsafe   {')).toBe(true);
  });

  test('does not match unsafe without opening brace', () => {
    expect(pattern.test('// This is unsafe')).toBe(false);
  });

  test('matches unsafe { in comments (single-line regex limitation)', () => {
    // Pattern cannot distinguish code from comments - flags for manual review
    expect(pattern.test('// unsafe {')).toBe(true);
  });

  test('does not match unsafe fn declaration', () => {
    expect(pattern.test('unsafe fn do_thing()')).toBe(false);
  });

  test('does not match unsafe impl', () => {
    expect(pattern.test('unsafe impl Send for MyType')).toBe(false);
  });

  test('excludes test files and benchmarks', () => {
    expect(isFileExcluded('ffi_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/ffi.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/ffi.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// New pattern: rust_hardcoded_path
// ============================================================================

describe('rust_hardcoded_path', () => {
  const { pattern, exclude } = slopPatterns.rust_hardcoded_path;

  test('matches "/home/user/config"', () => {
    expect(pattern.test('let path = "/home/user/config";')).toBe(true);
  });

  test('matches "/tmp/cache"', () => {
    expect(pattern.test('let tmp = "/tmp/cache/data";')).toBe(true);
  });

  test('matches "/etc/myapp.conf"', () => {
    expect(pattern.test('let conf = "/etc/myapp.conf";')).toBe(true);
  });

  test('matches "/usr/local/bin"', () => {
    expect(pattern.test('let bin = "/usr/local/bin/tool";')).toBe(true);
  });

  test('matches "/var/log/app.log"', () => {
    expect(pattern.test('let log = "/var/log/app.log";')).toBe(true);
  });

  test('matches "/opt/service"', () => {
    expect(pattern.test('let svc = "/opt/service/run";')).toBe(true);
  });

  test('matches raw strings r"/home/..."', () => {
    expect(pattern.test('let p = r"/home/user/data";')).toBe(true);
  });

  test('matches raw strings r#"/tmp/..."#', () => {
    expect(pattern.test('let p = r#"/tmp/cache/data"#;')).toBe(true);
  });

  test('does not match URL paths', () => {
    // URL paths don't start with quote+slash pattern
    expect(pattern.test('let url = "https://example.com/home/user";')).toBe(false);
  });

  test('does not match relative paths', () => {
    expect(pattern.test('let p = "config/settings.toml";')).toBe(false);
  });

  test('does not match env var references', () => {
    expect(pattern.test('let p = std::env::var("HOME");')).toBe(false);
  });

  test('does not match just "/" root', () => {
    expect(pattern.test('let p = "/";')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('config_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/paths.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// New pattern: rust_expect_production
// ============================================================================

describe('rust_expect_production', () => {
  const { pattern, exclude } = slopPatterns.rust_expect_production;

  test('matches .expect("message")', () => {
    expect(pattern.test('let val = result.expect("should not fail");')).toBe(true);
  });

  test('matches .expect(\'message\')', () => {
    expect(pattern.test("let val = result.expect('should work');")).toBe(true);
  });

  test('matches .expect with leading spaces', () => {
    expect(pattern.test('    result.expect("failed to parse")')).toBe(true);
  });

  test('does not match .expect() without string arg', () => {
    expect(pattern.test('result.expect(error_msg)')).toBe(false);
  });

  test('does not match .unwrap()', () => {
    expect(pattern.test('result.unwrap()')).toBe(false);
  });

  test('does not match expected as identifier', () => {
    expect(pattern.test('let expected = 42;')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('parser_tests.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.rs', exclude)).toBe(true);
  });

  test('excludes examples, benchmarks, and build.rs', () => {
    expect(isFileExcluded('crate/examples/demo.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/perf.rs', exclude)).toBe(true);
    expect(isFileExcluded('build.rs', exclude)).toBe(true);
  });

  test('does not exclude main.rs (expect in main is still flagged)', () => {
    expect(isFileExcluded('src/main.rs', exclude)).toBe(false);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/lib.rs', exclude)).toBe(false);
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});
