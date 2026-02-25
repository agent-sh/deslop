/**
 * Tests for Rust slop detection patterns
 * Covers all 11 Rust-specific patterns
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

  test('getPatternsForLanguageOnly("rust") returns exactly 11 patterns', () => {
    const rustOnly = getPatternsForLanguageOnly('rust');
    expect(Object.keys(rustOnly)).toHaveLength(11);
  });

  test('all 11 Rust pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('rust'));
    expect(names).toContain('rust_debugging');
    expect(names).toContain('rust_println_in_lib');
    expect(names).toContain('placeholder_todo_rust');
    expect(names).toContain('placeholder_panic_todo_rust');
    expect(names).toContain('rust_bare_unwrap');
    expect(names).toContain('rust_log_debug');
    expect(names).toContain('rust_empty_match_arm');
    expect(names).toContain('rust_unnecessary_clone');
    expect(names).toContain('rust_unsafe_block');
    expect(names).toContain('rust_hardcoded_path');
    expect(names).toContain('rust_expect_production');
  });

  test('getPatternsForLanguage("rust") includes universal patterns', () => {
    const rustAll = getPatternsForLanguage('rust');
    const rustOnly = getPatternsForLanguageOnly('rust');
    expect(Object.keys(rustAll).length).toBeGreaterThan(Object.keys(rustOnly).length);
  });

  test('all Rust patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('rust'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'rust');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// rust_debugging - dbg!() only
// ============================================================================

describe('rust_debugging', () => {
  const { pattern, exclude } = slopPatterns.rust_debugging;

  test('matches dbg!()', () => {
    expect(pattern.test('dbg!(my_value);')).toBe(true);
  });

  test('matches dbg!() with expression', () => {
    expect(pattern.test('dbg!(x + y);')).toBe(true);
  });

  test('does not match println!()', () => {
    expect(pattern.test('println!("value: {}", x);')).toBe(false);
  });

  test('does not match eprintln!()', () => {
    expect(pattern.test('eprintln!("error")')).toBe(false);
  });

  test('does not match format!()', () => {
    expect(pattern.test('format!("hello {}", name)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('my_module_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('my_module_tests.rs', exclude)).toBe(true);
  });

  test('excludes tests.rs files (Rust inline test modules)', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/integration.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// rust_println_in_lib - println!/eprintln! in library code
// ============================================================================

describe('rust_println_in_lib', () => {
  const { pattern, exclude } = slopPatterns.rust_println_in_lib;

  test('matches println!()', () => {
    expect(pattern.test('println!("value: {}", x);')).toBe(true);
  });

  test('matches eprintln!()', () => {
    expect(pattern.test('eprintln!("error: {}", e);')).toBe(true);
  });

  test('does not match dbg!()', () => {
    expect(pattern.test('dbg!(value);')).toBe(false);
  });

  test('does not match format!()', () => {
    expect(pattern.test('format!("hello")')).toBe(false);
  });

  test('excludes build.rs (cargo build protocol)', () => {
    expect(isFileExcluded('build.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/build.rs', exclude)).toBe(true);
  });

  test('excludes main.rs (CLI output is legitimate)', () => {
    expect(isFileExcluded('src/main.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/src/main.rs', exclude)).toBe(true);
  });

  test('excludes binary targets (src/bin/)', () => {
    expect(isFileExcluded('src/bin/my_tool.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/src/bin/runner.rs', exclude)).toBe(true);
  });

  test('excludes test files and tests.rs modules', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });

  test('does not exclude regular library source files', () => {
    expect(isFileExcluded('src/lib.rs', exclude)).toBe(false);
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// placeholder_todo_rust
// ============================================================================

describe('placeholder_todo_rust', () => {
  const { pattern, exclude } = slopPatterns.placeholder_todo_rust;

  test('matches todo!()', () => {
    expect(pattern.test('todo!("implement later")')).toBe(true);
  });

  test('matches unimplemented!()', () => {
    expect(pattern.test('unimplemented!("not yet")')).toBe(true);
  });

  test('does not match todo in comments', () => {
    expect(pattern.test('// todo: fix this later')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/integration.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// placeholder_panic_todo_rust
// ============================================================================

describe('placeholder_panic_todo_rust', () => {
  const { pattern, exclude } = slopPatterns.placeholder_panic_todo_rust;

  test('matches panic!("TODO: ...")', () => {
    expect(pattern.test('panic!("TODO: implement this")')).toBe(true);
  });

  test('does not match panic! without TODO/implement', () => {
    expect(pattern.test('panic!("invalid state: {}", state)')).toBe(false);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/unit.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// rust_bare_unwrap (tuned: severity low, broader excludes)
// ============================================================================

describe('rust_bare_unwrap', () => {
  const { pattern, exclude } = slopPatterns.rust_bare_unwrap;

  test('matches .unwrap()', () => {
    expect(pattern.test('let val = result.unwrap();')).toBe(true);
  });

  test('does not match .unwrap_or()', () => {
    expect(pattern.test('result.unwrap_or(default)')).toBe(false);
  });

  test('does not match .unwrap_or_default()', () => {
    expect(pattern.test('result.unwrap_or_default()')).toBe(false);
  });

  test('severity is low (tuned for noise reduction)', () => {
    expect(slopPatterns.rust_bare_unwrap.severity).toBe('low');
  });

  test('excludes test files and tests.rs modules', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });

  test('excludes examples, benchmarks, and build.rs', () => {
    expect(isFileExcluded('crate/examples/basic.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/perf.rs', exclude)).toBe(true);
    expect(isFileExcluded('build.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// rust_log_debug (tuned: includes tracing crate)
// ============================================================================

describe('rust_log_debug', () => {
  const { pattern, exclude } = slopPatterns.rust_log_debug;

  test('matches log::debug!()', () => {
    expect(pattern.test('log::debug!("entering function");')).toBe(true);
  });

  test('matches log::trace!()', () => {
    expect(pattern.test('log::trace!("detailed trace info");')).toBe(true);
  });

  test('matches tracing::debug!()', () => {
    expect(pattern.test('tracing::debug!("entering function");')).toBe(true);
  });

  test('matches tracing::trace!()', () => {
    expect(pattern.test('tracing::trace!("detailed info");')).toBe(true);
  });

  test('matches tracing::debug! with structured fields', () => {
    expect(pattern.test('tracing::debug!(config_path = ?p, "Resolved");')).toBe(true);
  });

  test('does not match log::info!()', () => {
    expect(pattern.test('log::info!("server started");')).toBe(false);
  });

  test('does not match tracing::info!()', () => {
    expect(pattern.test('tracing::info!("server started");')).toBe(false);
  });

  test('does not match debug as variable name', () => {
    expect(pattern.test('let debug = true;')).toBe(false);
  });

  test('severity is low (intentional logging is not always slop)', () => {
    expect(slopPatterns.rust_log_debug.severity).toBe('low');
  });

  test('excludes test files and tests.rs modules', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/integration.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/lib.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// rust_empty_match_arm
// ============================================================================

describe('rust_empty_match_arm', () => {
  const { pattern, exclude } = slopPatterns.rust_empty_match_arm;

  test('matches Err(e) => {}', () => {
    expect(pattern.test('Err(e) => {}')).toBe(true);
  });

  test('matches Err(_) => {}', () => {
    expect(pattern.test('Err(_) => {}')).toBe(true);
  });

  test('matches Err(e) => ()', () => {
    expect(pattern.test('Err(e) => ()')).toBe(true);
  });

  test('does not match Err with handler body', () => {
    expect(pattern.test('Err(e) => { log::error!("{}", e); }')).toBe(false);
  });

  test('scope is limited to Err', () => {
    expect(pattern.test('Some(_) => {}')).toBe(false);
  });

  test('excludes tests.rs modules', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// rust_unnecessary_clone (tuned: broader excludes)
// ============================================================================

describe('rust_unnecessary_clone', () => {
  const { pattern, exclude } = slopPatterns.rust_unnecessary_clone;

  test('matches .clone()', () => {
    expect(pattern.test('let copy = value.clone();')).toBe(true);
  });

  test('does not match clone_from', () => {
    expect(pattern.test('value.clone_from(&other)')).toBe(false);
  });

  test('does not match #[derive(Clone)]', () => {
    expect(pattern.test('#[derive(Clone)]')).toBe(false);
  });

  test('excludes tests.rs modules and build.rs', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
    expect(isFileExcluded('build.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/throughput.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// rust_unsafe_block
// ============================================================================

describe('rust_unsafe_block', () => {
  const { pattern, exclude } = slopPatterns.rust_unsafe_block;

  test('matches unsafe {', () => {
    expect(pattern.test('unsafe {')).toBe(true);
  });

  test('does not match unsafe fn', () => {
    expect(pattern.test('unsafe fn do_thing()')).toBe(false);
  });

  test('does not match unsafe impl', () => {
    expect(pattern.test('unsafe impl Send for MyType')).toBe(false);
  });

  test('excludes tests.rs modules and benchmarks', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/ffi.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/ffi.rs', exclude)).toBe(false);
  });
});

// ============================================================================
// rust_hardcoded_path (tuned: tests.rs exclude)
// ============================================================================

describe('rust_hardcoded_path', () => {
  const { pattern, exclude } = slopPatterns.rust_hardcoded_path;

  test('matches "/home/user/config"', () => {
    expect(pattern.test('let p = "/home/user/config";')).toBe(true);
  });

  test('matches "/tmp/cache"', () => {
    expect(pattern.test('let p = "/tmp/cache/data";')).toBe(true);
  });

  test('matches raw strings r"/home/..."', () => {
    expect(pattern.test('let p = r"/home/user/data";')).toBe(true);
  });

  test('does not match standard daemon socket paths (/var/run/)', () => {
    expect(pattern.test('"/var/run/redis.sock"')).toBe(false);
    expect(pattern.test('"/var/run/mysqld/mysqld.sock"')).toBe(false);
  });

  test('still matches other /var/ paths', () => {
    expect(pattern.test('"/var/log/app.log"')).toBe(true);
    expect(pattern.test('"/var/data/myapp"')).toBe(true);
  });

  test('does not match URL paths', () => {
    expect(pattern.test('"https://example.com/home/user"')).toBe(false);
  });

  test('does not match relative paths', () => {
    expect(pattern.test('"config/settings.toml"')).toBe(false);
  });

  test('excludes tests.rs modules', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
    expect(isFileExcluded('config_test.rs', exclude)).toBe(true);
  });
});

// ============================================================================
// rust_expect_production (tuned: severity low, excludes main.rs + bin/)
// ============================================================================

describe('rust_expect_production', () => {
  const { pattern, exclude } = slopPatterns.rust_expect_production;

  test('matches .expect("message")', () => {
    expect(pattern.test('result.expect("should not fail");')).toBe(true);
  });

  test('does not match .expect() without string arg', () => {
    expect(pattern.test('result.expect(error_msg)')).toBe(false);
  });

  test('does not match .unwrap()', () => {
    expect(pattern.test('result.unwrap()')).toBe(false);
  });

  test('severity is low (tuned for noise reduction)', () => {
    expect(slopPatterns.rust_expect_production.severity).toBe('low');
  });

  test('excludes tests.rs modules', () => {
    expect(isFileExcluded('src/config/tests.rs', exclude)).toBe(true);
  });

  test('excludes examples, benchmarks, and build.rs', () => {
    expect(isFileExcluded('crate/examples/demo.rs', exclude)).toBe(true);
    expect(isFileExcluded('build.rs', exclude)).toBe(true);
  });

  test('excludes main.rs and binary targets', () => {
    expect(isFileExcluded('src/main.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/src/main.rs', exclude)).toBe(true);
    expect(isFileExcluded('src/bin/my_tool.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/src/bin/runner.rs', exclude)).toBe(true);
  });

  test('does not exclude regular library source files', () => {
    expect(isFileExcluded('src/lib.rs', exclude)).toBe(false);
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});
