/**
 * Tests for Python slop detection patterns
 * Covers all 6 Python-specific patterns
 */

const {
  slopPatterns,
  getPatternsForLanguage,
  getPatternsForLanguageOnly,
  isFileExcluded,
  hasLanguage
} = require('../lib/patterns/slop-patterns');
const { detectLanguage } = require('../lib/patterns/slop-analyzers');

// ============================================================================
// Integration tests
// ============================================================================

describe('Python language integration', () => {
  test('hasLanguage("python") returns true', () => {
    expect(hasLanguage('python')).toBe(true);
  });

  test('getPatternsForLanguageOnly("python") returns exactly 6 patterns', () => {
    const pythonOnly = getPatternsForLanguageOnly('python');
    expect(Object.keys(pythonOnly)).toHaveLength(6);
  });

  test('all 6 Python pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('python'));
    expect(names).toContain('python_debugging');
    expect(names).toContain('placeholder_not_implemented_py');
    expect(names).toContain('placeholder_pass_only_py');
    expect(names).toContain('placeholder_ellipsis_py');
    expect(names).toContain('empty_except_py');
    expect(names).toContain('mutable_globals_py');
  });

  test('getPatternsForLanguage("python") includes universal patterns', () => {
    const pythonAll = getPatternsForLanguage('python');
    const pythonOnly = getPatternsForLanguageOnly('python');
    expect(Object.keys(pythonAll).length).toBeGreaterThan(Object.keys(pythonOnly).length);
  });

  test('all Python patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('python'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'python');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// python_debugging - pdb, ipdb, breakpoint(), print()
// ============================================================================

describe('python_debugging', () => {
  const { pattern, exclude } = slopPatterns.python_debugging;

  test('matches import pdb', () => {
    expect(pattern.test('import pdb')).toBe(true);
  });

  test('matches import ipdb', () => {
    expect(pattern.test('import ipdb')).toBe(true);
  });

  test('matches breakpoint()', () => {
    expect(pattern.test('breakpoint()')).toBe(true);
  });

  test('matches print()', () => {
    expect(pattern.test('print("hello world")')).toBe(true);
  });

  test('does not match print in function name', () => {
    expect(pattern.test('def print_report():')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('main_test.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });
});

// ============================================================================
// placeholder_not_implemented_py
// ============================================================================

describe('placeholder_not_implemented_py', () => {
  const { pattern, exclude } = slopPatterns.placeholder_not_implemented_py;

  test('matches raise NotImplementedError', () => {
    expect(pattern.test('raise NotImplementedError')).toBe(true);
  });

  test('matches raise NotImplementedError with message', () => {
    expect(pattern.test('raise NotImplementedError("not yet")')).toBe(true);
  });

  test('does not match NotImplementedError in except', () => {
    expect(pattern.test('except NotImplementedError:')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('main_test.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/unit.py', exclude)).toBe(true);
  });
});

// ============================================================================
// placeholder_pass_only_py
// ============================================================================

describe('placeholder_pass_only_py', () => {
  const { pattern, exclude } = slopPatterns.placeholder_pass_only_py;

  test('matches single-line def with pass', () => {
    expect(pattern.test('def foo(): pass')).toBe(true);
  });

  test('matches multi-line def with pass', () => {
    expect(pattern.test('def foo():\n    pass')).toBe(true);
  });

  test('does not match function with body', () => {
    expect(pattern.test('def foo():\n    return 42')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });
});

// ============================================================================
// placeholder_ellipsis_py
// ============================================================================

describe('placeholder_ellipsis_py', () => {
  const { pattern, exclude } = slopPatterns.placeholder_ellipsis_py;

  test('matches single-line def with ellipsis', () => {
    expect(pattern.test('def foo(): ...')).toBe(true);
  });

  test('matches multi-line def with ellipsis', () => {
    expect(pattern.test('def foo():\n    ...')).toBe(true);
  });

  test('does not match function with body', () => {
    expect(pattern.test('def foo():\n    return 42')).toBe(false);
  });

  test('excludes .pyi stub files', () => {
    expect(isFileExcluded('module.pyi', exclude)).toBe(true);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('main_test.py', exclude)).toBe(true);
  });
});

// ============================================================================
// empty_except_py
// ============================================================================

describe('empty_except_py', () => {
  const { pattern } = slopPatterns.empty_except_py;

  test('matches except with just pass', () => {
    expect(pattern.test('except Exception: pass')).toBe(true);
  });

  test('matches except ValueError: pass', () => {
    expect(pattern.test('except ValueError: pass')).toBe(true);
  });

  test('does not match except with handler body', () => {
    expect(pattern.test('except Exception:\n    logger.error(e)')).toBe(false);
  });
});

// ============================================================================
// mutable_globals_py
// ============================================================================

describe('mutable_globals_py', () => {
  const { pattern, exclude } = slopPatterns.mutable_globals_py;

  test('matches UPPERCASE = []', () => {
    expect(pattern.test('CACHE = []')).toBe(true);
  });

  test('matches UPPERCASE = list()', () => {
    expect(pattern.test('ITEMS = list()')).toBe(true);
  });

  test('matches UPPERCASE = {}', () => {
    expect(pattern.test('REGISTRY = {}')).toBe(true);
  });

  test('matches UPPERCASE = dict()', () => {
    expect(pattern.test('CONFIG = dict()')).toBe(true);
  });

  test('matches UPPERCASE = set()', () => {
    expect(pattern.test('SEEN = set()')).toBe(true);
  });

  test('does not match lowercase = []', () => {
    expect(pattern.test('items = []')).toBe(false);
  });

  test('does not match UPPERCASE = "string"', () => {
    expect(pattern.test('NAME = "hello"')).toBe(false);
  });

  test('excludes constants.py, settings.py, config.py', () => {
    expect(isFileExcluded('constants.py', exclude)).toBe(true);
    expect(isFileExcluded('settings.py', exclude)).toBe(true);
  });

  test('excludes test files and directories', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.py', exclude)).toBe(true);
  });
});

// ============================================================================
// detectLanguage extension-based detection
// ============================================================================

describe('detectLanguage', () => {
  test('detects python from .py extension', () => {
    expect(detectLanguage('script.py')).toBe('python');
  });

  test('detects rust from .rs extension', () => {
    expect(detectLanguage('script.rs')).toBe('rust');
  });

  test('falls back to js when no extension match', () => {
    expect(detectLanguage('myscript')).toBe('js');
  });
});
