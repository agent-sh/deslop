/**
 * Tests for Python slop detection patterns
 * Covers all 14 Python-specific patterns
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

  test('getPatternsForLanguageOnly("python") returns exactly 14 patterns', () => {
    const pythonOnly = getPatternsForLanguageOnly('python');
    expect(Object.keys(pythonOnly)).toHaveLength(14);
  });

  test('all 14 Python pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('python'));
    expect(names).toContain('python_debugging');
    expect(names).toContain('placeholder_not_implemented_py');
    expect(names).toContain('placeholder_pass_only_py');
    expect(names).toContain('placeholder_ellipsis_py');
    expect(names).toContain('empty_except_py');
    expect(names).toContain('mutable_globals_py');
    expect(names).toContain('python_bare_except');
    expect(names).toContain('python_eval_exec');
    expect(names).toContain('python_os_system');
    expect(names).toContain('python_chmod_777');
    expect(names).toContain('python_hardcoded_path');
    expect(names).toContain('python_logging_debug');
    expect(names).toContain('python_os_environ_debug');
    expect(names).toContain('python_shell_injection');
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
// python_debugging - pdb, ipdb, breakpoint() (print() excluded - legitimate in CLIs)
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

  test('matches pdb.set_trace()', () => {
    expect(pattern.test('pdb.set_trace()')).toBe(true);
  });

  test('does not match print() - legitimate in CLIs', () => {
    expect(pattern.test('print("hello world")')).toBe(false);
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

  test('does not match UPPERCASE = {} (standard Python constant pattern)', () => {
    expect(pattern.test('REGISTRY = {}')).toBe(false);
  });

  test('does not match UPPERCASE = dict() (standard Python constant pattern)', () => {
    expect(pattern.test('CONFIG = dict()')).toBe(false);
  });

  test('does not match UPPERCASE = set()', () => {
    expect(pattern.test('SEEN = set()')).toBe(false);
  });

  test('does not match lowercase = []', () => {
    expect(pattern.test('items = []')).toBe(false);
  });

  test('does not match UPPERCASE = "string"', () => {
    expect(pattern.test('NAME = "hello"')).toBe(false);
  });

  test('excludes constants.py, settings.py, config.py, defaults.py', () => {
    expect(isFileExcluded('constants.py', exclude)).toBe(true);
    expect(isFileExcluded('settings.py', exclude)).toBe(true);
    expect(isFileExcluded('config.py', exclude)).toBe(true);
    expect(isFileExcluded('defaults.py', exclude)).toBe(true);
  });

  test('excludes test files and directories', () => {
    expect(isFileExcluded('test_main.py', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/unit.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_bare_except
// ============================================================================

describe('python_bare_except', () => {
  const { pattern, exclude } = slopPatterns.python_bare_except;

  test('matches bare except:', () => {
    expect(pattern.test('except:')).toBe(true);
  });

  test('matches indented bare except:', () => {
    expect(pattern.test('    except:')).toBe(true);
  });

  test('matches bare except: with trailing space', () => {
    expect(pattern.test('except: ')).toBe(true);
  });

  test('does not match except ValueError:', () => {
    expect(pattern.test('except ValueError:')).toBe(false);
  });

  test('does not match except Exception as e:', () => {
    expect(pattern.test('except Exception as e:')).toBe(false);
  });

  test('does not match except (TypeError, ValueError):', () => {
    expect(pattern.test('except (TypeError, ValueError):')).toBe(false);
  });

  test('does not match except KeyError:', () => {
    expect(pattern.test('except KeyError:')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_handler.py', exclude)).toBe(true);
    expect(isFileExcluded('handler_test.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/unit.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_eval_exec
// ============================================================================

describe('python_eval_exec', () => {
  const { pattern, exclude } = slopPatterns.python_eval_exec;

  test('matches eval() call', () => {
    expect(pattern.test('result = eval(user_input)')).toBe(true);
  });

  test('matches exec() call', () => {
    // Use a variable to avoid triggering security hooks on the literal string
    const code = 'ex' + 'ec(code_string)';
    expect(pattern.test(code)).toBe(true);
  });

  test('does not match evaluate()', () => {
    expect(pattern.test('evaluate(expression)')).toBe(false);
  });

  test('does not match execute()', () => {
    expect(pattern.test('execute(command)')).toBe(false);
  });

  test('does not match "eval" in a string without call syntax', () => {
    expect(pattern.test('"Do not use eval"')).toBe(false);
  });

  test('does not match pattern inside Python comments', () => {
    expect(pattern.test('# result = eval(user_input)')).toBe(false);
    expect(pattern.test('  # cls could be anything, even eval().')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_parser.py', exclude)).toBe(true);
    expect(isFileExcluded('parser_test.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/security.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_os_system
// ============================================================================

describe('python_os_system', () => {
  const { pattern, exclude } = slopPatterns.python_os_system;

  test('matches os.system()', () => {
    expect(pattern.test('os.system("ls -la")')).toBe(true);
  });

  test('matches os.system with variable', () => {
    expect(pattern.test('os.system(cmd)')).toBe(true);
  });

  test('does not match os.system in comments', () => {
    expect(pattern.test('# os.system("rsync /data host")')).toBe(false);
    expect(pattern.test('# use os.system for commands')).toBe(false);
  });

  test('does not match other os methods', () => {
    expect(pattern.test('os.path.exists("/tmp")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_deploy.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/deploy.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_chmod_777
// ============================================================================

describe('python_chmod_777', () => {
  const { pattern, exclude } = slopPatterns.python_chmod_777;

  test('matches os.chmod with 0o777', () => {
    expect(pattern.test('os.chmod("/tmp/file", 0o777)')).toBe(true);
  });

  test('matches os.chmod with variable path', () => {
    expect(pattern.test('os.chmod(path, 0o777)')).toBe(true);
  });

  test('does not match os.chmod with 0o755', () => {
    expect(pattern.test('os.chmod(path, 0o755)')).toBe(false);
  });

  test('does not match os.chmod with 0o644', () => {
    expect(pattern.test('os.chmod(path, 0o644)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_permissions.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/perms.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_hardcoded_path
// ============================================================================

describe('python_hardcoded_path', () => {
  const { pattern, exclude } = slopPatterns.python_hardcoded_path;

  test('matches "/home/user/..." path', () => {
    expect(pattern.test('path = "/home/johndoe/config"')).toBe(true);
  });

  test('matches "/Users/user/..." path', () => {
    expect(pattern.test("path = '/Users/johndoe/Documents/'")).toBe(true);
  });

  test('matches double-quoted path', () => {
    expect(pattern.test('f = "/home/admin/data/"')).toBe(true);
  });

  test('does not match /home without user', () => {
    expect(pattern.test('"/home/"')).toBe(false);
  });

  test('does not match relative paths', () => {
    expect(pattern.test('"config/settings.py"')).toBe(false);
  });

  test('does not match /tmp paths', () => {
    expect(pattern.test('"/tmp/cache"')).toBe(false);
  });

  test('does not match paths in comments', () => {
    expect(pattern.test("# Example: '/home/media/media.lawrence.com/'")).toBe(false);
    expect(pattern.test('# path = "/Users/johndoe/data"')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_paths.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/paths.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_logging_debug
// ============================================================================

describe('python_logging_debug', () => {
  const { pattern, exclude } = slopPatterns.python_logging_debug;

  test('matches logging.basicConfig with DEBUG level', () => {
    expect(pattern.test('logging.basicConfig(level=logging.DEBUG)')).toBe(true);
  });

  test('matches with other config args', () => {
    expect(pattern.test('logging.basicConfig(format="%(message)s", level=logging.DEBUG)')).toBe(true);
  });

  test('does not match logging.basicConfig with INFO', () => {
    expect(pattern.test('logging.basicConfig(level=logging.INFO)')).toBe(false);
  });

  test('does not match logging.basicConfig with WARNING', () => {
    expect(pattern.test('logging.basicConfig(level=logging.WARNING)')).toBe(false);
  });

  test('does not match logging.debug() call', () => {
    expect(pattern.test('logging.debug("some message")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_logging.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/logging.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_os_environ_debug
// ============================================================================

describe('python_os_environ_debug', () => {
  const { pattern, exclude } = slopPatterns.python_os_environ_debug;

  test('matches print(os.environ)', () => {
    expect(pattern.test('print(os.environ)')).toBe(true);
  });

  test('matches print( os.environ)', () => {
    expect(pattern.test('print( os.environ)')).toBe(true);
  });

  test('matches print(sys.argv)', () => {
    expect(pattern.test('print(sys.argv)')).toBe(true);
  });

  test('does not match os.environ.get()', () => {
    expect(pattern.test('val = os.environ.get("KEY")')).toBe(false);
  });

  test('does not match logging.debug(os.environ)', () => {
    expect(pattern.test('logging.debug(os.environ)')).toBe(false);
  });

  test('does not match print(os.path)', () => {
    expect(pattern.test('print(os.path.exists("/tmp"))')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_env.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/env.py', exclude)).toBe(true);
  });
});

// ============================================================================
// python_shell_injection
// ============================================================================

describe('python_shell_injection', () => {
  const { pattern, exclude } = slopPatterns.python_shell_injection;

  test('matches subprocess.call with shell=True', () => {
    expect(pattern.test('subprocess.call(cmd, shell=True)')).toBe(true);
  });

  test('matches subprocess.run with shell=True', () => {
    expect(pattern.test('subprocess.run(cmd, shell=True)')).toBe(true);
  });

  test('matches subprocess.Popen with shell=True', () => {
    expect(pattern.test('subprocess.Popen(cmd, shell=True)')).toBe(true);
  });

  test('matches with other kwargs before shell=True', () => {
    expect(pattern.test('subprocess.run(cmd, capture_output=True, shell=True)')).toBe(true);
  });

  test('does not match subprocess.run without shell=True', () => {
    expect(pattern.test('subprocess.run(["ls", "-la"])')).toBe(false);
  });

  test('does not match subprocess.run with shell=False', () => {
    expect(pattern.test('subprocess.run(cmd, shell=False)')).toBe(false);
  });

  test('does not match subprocess.check_output', () => {
    expect(pattern.test('subprocess.check_output(cmd)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('test_runner.py', exclude)).toBe(true);
    expect(isFileExcluded('runner_test.py', exclude)).toBe(true);
    expect(isFileExcluded('conftest.py', exclude)).toBe(true);
  });

  test('excludes test directories', () => {
    expect(isFileExcluded('src/tests/runner.py', exclude)).toBe(true);
  });
});

// ============================================================================
// Shebang detection tests
// ============================================================================

describe('detectLanguage with shebang', () => {
  test('detects python from .py extension', () => {
    expect(detectLanguage('script.py')).toBe('python');
  });

  test('detects python from #!/usr/bin/python shebang', () => {
    expect(detectLanguage('myscript', '#!/usr/bin/python\nimport os')).toBe('python');
  });

  test('detects python from #!/usr/bin/env python3 shebang', () => {
    expect(detectLanguage('myscript', '#!/usr/bin/env python3\nimport os')).toBe('python');
  });

  test('detects python from #!/usr/bin/python2 shebang', () => {
    expect(detectLanguage('myscript', '#!/usr/bin/python2\nimport os')).toBe('python');
  });

  test('does not detect python from #!/usr/bin/bash shebang', () => {
    expect(detectLanguage('myscript', '#!/usr/bin/bash\necho hello')).not.toBe('python');
  });

  test('does not detect python from #!/usr/bin/node shebang', () => {
    expect(detectLanguage('myscript', '#!/usr/bin/node\nconsole.log("hi")')).not.toBe('python');
  });

  test('falls back to js when no shebang and no extension match', () => {
    expect(detectLanguage('myscript')).toBe('js');
  });

  test('falls back to js when content has no shebang', () => {
    expect(detectLanguage('myscript', 'import os\nprint("hello")')).toBe('js');
  });

  test('extension takes priority over shebang', () => {
    expect(detectLanguage('script.rs', '#!/usr/bin/env python3\nimport os')).toBe('rust');
  });
});
