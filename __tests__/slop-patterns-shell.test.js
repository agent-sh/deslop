/**
 * Tests for Shell/Bash slop detection patterns
 * Covers all 10 shell-specific patterns
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
  test('hasLanguage("shell") returns true', () => {
    expect(hasLanguage('shell')).toBe(true);
  });

  test('getPatternsForLanguageOnly("shell") returns exactly 10 patterns', () => {
    const shellOnly = getPatternsForLanguageOnly('shell');
    expect(Object.keys(shellOnly)).toHaveLength(10);
  });

  test('getPatternsForLanguage("shell") includes universal patterns', () => {
    const shellAll = getPatternsForLanguage('shell');
    const shellOnly = getPatternsForLanguageOnly('shell');
    expect(Object.keys(shellAll).length).toBeGreaterThan(Object.keys(shellOnly).length);
  });

  test('all shell patterns have required fields', () => {
    const shellPatterns = getPatternsForLanguageOnly('shell');
    for (const [name, pattern] of Object.entries(shellPatterns)) {
      expect(pattern).toHaveProperty('pattern');
      expect(pattern).toHaveProperty('exclude');
      expect(pattern).toHaveProperty('severity');
      expect(pattern).toHaveProperty('autoFix');
      expect(pattern).toHaveProperty('language', 'shell');
      expect(pattern).toHaveProperty('description');
      expect(typeof pattern.description).toBe('string');
      expect(Array.isArray(pattern.exclude)).toBe(true);
    }
  });

  test('all 10 pattern names are present', () => {
    const shellPatterns = getPatternsForLanguageOnly('shell');
    const names = Object.keys(shellPatterns);
    expect(names).toContain('shell_debugging');
    expect(names).toContain('shell_echo_debug');
    expect(names).toContain('shell_placeholder_todo');
    expect(names).toContain('shell_error_silencing');
    expect(names).toContain('shell_empty_trap');
    expect(names).toContain('shell_hardcoded_path');
    expect(names).toContain('shell_chmod_777');
    expect(names).toContain('shell_curl_pipe_bash');
    expect(names).toContain('shell_unquoted_variable');
    expect(names).toContain('shell_eval_usage');
  });
});

// ============================================================================
// shell_debugging
// ============================================================================

describe('shell_debugging', () => {
  const { pattern, exclude } = slopPatterns.shell_debugging;

  test('matches set -x', () => {
    expect(pattern.test('set -x')).toBe(true);
  });

  test('matches set -v with leading spaces', () => {
    expect(pattern.test('  set -v')).toBe(true);
  });

  test('matches set -xv', () => {
    expect(pattern.test('set -xv')).toBe(true);
  });

  test('does not match set -e', () => {
    expect(pattern.test('set -e')).toBe(false);
  });

  test('does not match set -u', () => {
    expect(pattern.test('set -u')).toBe(false);
  });

  test('does not match set -euo pipefail', () => {
    expect(pattern.test('set -euo pipefail')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('deploy_test.sh', exclude)).toBe(true);
    expect(isFileExcluded('setup.test.sh', exclude)).toBe(true);
    expect(isFileExcluded('src/tests/run.sh', exclude)).toBe(true);
  });

  test('does not exclude regular scripts', () => {
    expect(isFileExcluded('deploy.sh', exclude)).toBe(false);
  });
});

// ============================================================================
// shell_echo_debug
// ============================================================================

describe('shell_echo_debug', () => {
  const { pattern, exclude } = slopPatterns.shell_echo_debug;

  test('matches echo "DEBUG: value"', () => {
    expect(pattern.test('echo "DEBUG: value"')).toBe(true);
  });

  test('matches echo \'TRACE message\'', () => {
    expect(pattern.test("echo 'TRACE message'")).toBe(true);
  });

  test('matches echo HERE', () => {
    expect(pattern.test('echo HERE')).toBe(true);
  });

  test('does not match echo "Starting server"', () => {
    expect(pattern.test('echo "Starting server"')).toBe(false);
  });

  test('does not match echo $PATH', () => {
    expect(pattern.test('echo $PATH')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('build_test.sh', exclude)).toBe(true);
    expect(isFileExcluded('scripts/tests/check.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_placeholder_todo
// ============================================================================

describe('shell_placeholder_todo', () => {
  const { pattern, exclude } = slopPatterns.shell_placeholder_todo;

  test('matches echo "not implemented"', () => {
    expect(pattern.test('echo "not implemented"')).toBe(true);
  });

  test('matches : "TODO implement"', () => {
    expect(pattern.test(': "TODO implement"')).toBe(true);
  });

  test('matches echo \'FIXME\'', () => {
    expect(pattern.test("echo 'FIXME'")).toBe(true);
  });

  test('does not match echo "Processing complete"', () => {
    expect(pattern.test('echo "Processing complete"')).toBe(false);
  });

  test('does not match # TODO: improve later', () => {
    expect(pattern.test('# TODO: improve later')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('setup_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_error_silencing
// ============================================================================

describe('shell_error_silencing', () => {
  const { pattern, exclude } = slopPatterns.shell_error_silencing;

  test('matches command || true', () => {
    expect(pattern.test('command || true')).toBe(true);
  });

  test('matches rm -f file || true with leading spaces', () => {
    expect(pattern.test('  rm -f file || true')).toBe(true);
  });

  test('does not match command || handle_error', () => {
    expect(pattern.test('command || handle_error')).toBe(false);
  });

  test('does not match # || true in comment', () => {
    expect(pattern.test('# || true')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('cleanup_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_empty_trap
// ============================================================================

describe('shell_empty_trap', () => {
  const { pattern, exclude } = slopPatterns.shell_empty_trap;

  test('matches trap \'\' SIGINT', () => {
    expect(pattern.test("trap '' SIGINT")).toBe(true);
  });

  test('matches trap "" EXIT', () => {
    expect(pattern.test('trap "" EXIT')).toBe(true);
  });

  test('does not match trap cleanup EXIT', () => {
    expect(pattern.test('trap cleanup EXIT')).toBe(false);
  });

  test('does not match trap \'rm -f $tmp\' EXIT', () => {
    expect(pattern.test("trap 'rm -f $tmp' EXIT")).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('signal_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_hardcoded_path
// ============================================================================

describe('shell_hardcoded_path', () => {
  const { pattern, exclude } = slopPatterns.shell_hardcoded_path;

  test('matches "/home/user/config"', () => {
    expect(pattern.test('"/home/user/config"')).toBe(true);
  });

  test('matches \'/Users/john/data\'', () => {
    expect(pattern.test("'/Users/john/data'")).toBe(true);
  });

  test('does not match "/usr/bin/env"', () => {
    expect(pattern.test('"/usr/bin/env"')).toBe(false);
  });

  test('does not match "/etc/hosts"', () => {
    expect(pattern.test('"/etc/hosts"')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('path_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_chmod_777
// ============================================================================

describe('shell_chmod_777', () => {
  const { pattern, exclude } = slopPatterns.shell_chmod_777;

  test('matches chmod 777 file', () => {
    expect(pattern.test('chmod 777 file')).toBe(true);
  });

  test('matches chmod -R 777 dir', () => {
    expect(pattern.test('chmod -R 777 dir')).toBe(true);
  });

  test('does not match chmod 755 file', () => {
    expect(pattern.test('chmod 755 file')).toBe(false);
  });

  test('does not match chmod 644 file', () => {
    expect(pattern.test('chmod 644 file')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('perms_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_curl_pipe_bash
// ============================================================================

describe('shell_curl_pipe_bash', () => {
  const { pattern, exclude } = slopPatterns.shell_curl_pipe_bash;

  test('matches curl -s url | bash', () => {
    expect(pattern.test('curl -s https://example.com/install.sh | bash')).toBe(true);
  });

  test('matches wget url | sh', () => {
    expect(pattern.test('wget https://example.com/setup.sh | sh')).toBe(true);
  });

  test('does not match curl -o file url', () => {
    expect(pattern.test('curl -o file.sh https://example.com/install.sh')).toBe(false);
  });

  test('does not match wget -O file url', () => {
    expect(pattern.test('wget -O file.sh https://example.com/setup.sh')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('install_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_unquoted_variable
// ============================================================================

describe('shell_unquoted_variable', () => {
  const { pattern, exclude } = slopPatterns.shell_unquoted_variable;

  test('matches rm $FILE', () => {
    expect(pattern.test('rm $FILE')).toBe(true);
  });

  test('matches cp $SRC dest', () => {
    expect(pattern.test('cp $SRC dest')).toBe(true);
  });

  test('does not match rm "$FILE"', () => {
    expect(pattern.test('rm "$FILE"')).toBe(false);
  });

  test('does not match echo $VAR', () => {
    expect(pattern.test('echo $VAR')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('cleanup_test.sh', exclude)).toBe(true);
  });
});

// ============================================================================
// shell_eval_usage
// ============================================================================

describe('shell_eval_usage', () => {
  const { pattern, exclude } = slopPatterns.shell_eval_usage;

  test('matches eval "$cmd"', () => {
    expect(pattern.test('eval "$cmd"')).toBe(true);
  });

  test('matches eval $command', () => {
    expect(pattern.test('eval $command')).toBe(true);
  });

  test('does not match # eval is dangerous', () => {
    expect(pattern.test('# eval is dangerous')).toBe(false);
  });

  test('does not match evaluate()', () => {
    expect(pattern.test('evaluate()')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('exec_test.sh', exclude)).toBe(true);
  });
});
