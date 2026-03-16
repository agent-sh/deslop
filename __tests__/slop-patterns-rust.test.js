/**
 * Tests for Rust slop detection patterns
 * Covers all 4 Rust-specific patterns
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

  test('getPatternsForLanguageOnly("rust") returns exactly 4 patterns', () => {
    const rustOnly = getPatternsForLanguageOnly('rust');
    expect(Object.keys(rustOnly)).toHaveLength(4);
  });

  test('all 4 Rust pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('rust'));
    expect(names).toContain('rust_debugging');
    expect(names).toContain('placeholder_todo_rust');
    expect(names).toContain('placeholder_panic_todo_rust');
    expect(names).toContain('rust_bare_unwrap');
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
// rust_debugging - println!, dbg!, eprintln!
// ============================================================================

describe('rust_debugging', () => {
  const { pattern, exclude } = slopPatterns.rust_debugging;

  test('matches dbg!()', () => {
    expect(pattern.test('dbg!(my_value);')).toBe(true);
  });

  test('matches dbg!() with expression', () => {
    expect(pattern.test('dbg!(x + y);')).toBe(true);
  });

  test('matches println!()', () => {
    expect(pattern.test('println!("value: {}", x);')).toBe(true);
  });

  test('matches eprintln!()', () => {
    expect(pattern.test('eprintln!("error")')).toBe(true);
  });

  test('does not match format!()', () => {
    expect(pattern.test('format!("hello {}", name)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('my_module_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('my_module_tests.rs', exclude)).toBe(true);
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
// rust_bare_unwrap
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

  test('severity is medium', () => {
    expect(slopPatterns.rust_bare_unwrap.severity).toBe('medium');
  });

  test('excludes test files', () => {
    expect(isFileExcluded('parser_test.rs', exclude)).toBe(true);
    expect(isFileExcluded('parser_tests.rs', exclude)).toBe(true);
  });

  test('excludes examples and benchmarks', () => {
    expect(isFileExcluded('crate/examples/basic.rs', exclude)).toBe(true);
    expect(isFileExcluded('crate/benches/perf.rs', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('src/parser.rs', exclude)).toBe(false);
  });
});
