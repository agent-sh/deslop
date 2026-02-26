/**
 * Tests for Go slop detection patterns
 * Covers all 9 Go-specific patterns (1 existing + 8 new)
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

describe('Go language integration', () => {
  test('hasLanguage("go") returns true', () => {
    expect(hasLanguage('go')).toBe(true);
  });

  test('getPatternsForLanguageOnly("go") returns exactly 9 patterns', () => {
    const goOnly = getPatternsForLanguageOnly('go');
    expect(Object.keys(goOnly)).toHaveLength(9);
  });

  test('all 9 Go pattern names are present', () => {
    const names = Object.keys(getPatternsForLanguageOnly('go'));
    expect(names).toContain('placeholder_panic_go');
    expect(names).toContain('go_fmt_debugging');
    expect(names).toContain('go_log_debugging');
    expect(names).toContain('go_spew_debugging');
    expect(names).toContain('go_empty_error_check');
    expect(names).toContain('go_discarded_error');
    expect(names).toContain('go_bare_os_exit');
    expect(names).toContain('go_empty_interface_param');
    expect(names).toContain('go_todo_empty_func');
  });

  test('getPatternsForLanguage("go") includes universal patterns', () => {
    const goAll = getPatternsForLanguage('go');
    const goOnly = getPatternsForLanguageOnly('go');
    expect(Object.keys(goAll).length).toBeGreaterThan(Object.keys(goOnly).length);
  });

  test('all Go patterns have required fields', () => {
    for (const [, p] of Object.entries(getPatternsForLanguageOnly('go'))) {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('exclude');
      expect(p).toHaveProperty('severity');
      expect(p).toHaveProperty('autoFix');
      expect(p).toHaveProperty('language', 'go');
      expect(p).toHaveProperty('description');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.exclude)).toBe(true);
    }
  });
});

// ============================================================================
// placeholder_panic_go (existing pattern)
// ============================================================================

describe('placeholder_panic_go', () => {
  const { pattern, exclude } = slopPatterns.placeholder_panic_go;

  test('matches panic("TODO: implement")', () => {
    expect(pattern.test('panic("TODO: implement this")')).toBe(true);
  });

  test('matches panic with "not implemented"', () => {
    expect(pattern.test('panic("not implemented yet")')).toBe(true);
  });

  test('does not match panic with normal message', () => {
    expect(pattern.test('panic("unexpected state: invalid")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes testdata directory', () => {
    expect(isFileExcluded('pkg/testdata/fixture.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('pkg/handler.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_fmt_debugging
// ============================================================================

describe('go_fmt_debugging', () => {
  const { pattern, exclude } = slopPatterns.go_fmt_debugging;

  test('matches fmt.Println()', () => {
    expect(pattern.test('fmt.Println("debug value:", x)')).toBe(true);
  });

  test('matches fmt.Printf()', () => {
    expect(pattern.test('fmt.Printf("value: %v\\n", x)')).toBe(true);
  });

  test('matches fmt.Print()', () => {
    expect(pattern.test('fmt.Print("hello")')).toBe(true);
  });

  test('does not match commented-out fmt.Println', () => {
    expect(pattern.test('// fmt.Println("debug")')).toBe(false);
    expect(pattern.test('  // fmt.Printf("value: %v", x)')).toBe(false);
  });

  test('does not match fmt.Sprintf()', () => {
    expect(pattern.test('s := fmt.Sprintf("value: %d", x)')).toBe(false);
  });

  test('does not match fmt.Errorf()', () => {
    expect(pattern.test('return fmt.Errorf("failed: %w", err)')).toBe(false);
  });

  test('does not match fmt.Fprintf()', () => {
    expect(pattern.test('fmt.Fprintf(w, "response")')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes testdata directory', () => {
    expect(isFileExcluded('pkg/testdata/fixture.go', exclude)).toBe(true);
  });

  test('excludes cmd directory', () => {
    expect(isFileExcluded('cmd/server/main.go', exclude)).toBe(true);
  });

  test('excludes main.go', () => {
    expect(isFileExcluded('main.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('pkg/handler.go', exclude)).toBe(false);
    expect(isFileExcluded('internal/service/worker.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_log_debugging
// ============================================================================

describe('go_log_debugging', () => {
  const { pattern, exclude } = slopPatterns.go_log_debugging;

  test('matches log.Println()', () => {
    expect(pattern.test('log.Println("starting server")')).toBe(true);
  });

  test('matches log.Printf()', () => {
    expect(pattern.test('log.Printf("port: %d", port)')).toBe(true);
  });

  test('matches log.Fatal()', () => {
    expect(pattern.test('log.Fatal(err)')).toBe(true);
  });

  test('matches log.Fatalf()', () => {
    expect(pattern.test('log.Fatalf("failed: %v", err)')).toBe(true);
  });

  test('matches log.Panicf()', () => {
    expect(pattern.test('log.Panicf("critical: %v", err)')).toBe(true);
  });

  test('does not match commented-out log calls', () => {
    expect(pattern.test('// log.Println("debug")')).toBe(false);
    expect(pattern.test('  // log.Fatal(err)')).toBe(false);
  });

  test('does not match slog.Info()', () => {
    expect(pattern.test('slog.Info("starting server")')).toBe(false);
  });

  test('does not match zap.Logger', () => {
    expect(pattern.test('logger.Info("started")')).toBe(false);
  });

  test('severity is low', () => {
    expect(slopPatterns.go_log_debugging.severity).toBe('low');
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes cmd directory and main.go', () => {
    expect(isFileExcluded('cmd/cli/root.go', exclude)).toBe(true);
    expect(isFileExcluded('main.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('internal/worker.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_spew_debugging
// ============================================================================

describe('go_spew_debugging', () => {
  const { pattern, exclude } = slopPatterns.go_spew_debugging;

  test('matches spew.Dump()', () => {
    expect(pattern.test('spew.Dump(config)')).toBe(true);
  });

  test('matches spew.Printf()', () => {
    expect(pattern.test('spew.Printf("config: %v", c)')).toBe(true);
  });

  test('matches spew.Sdump()', () => {
    expect(pattern.test('s := spew.Sdump(obj)')).toBe(true);
  });

  test('matches pp.Println()', () => {
    expect(pattern.test('pp.Println(result)')).toBe(true);
  });

  test('matches pp.Print()', () => {
    expect(pattern.test('pp.Print(data)')).toBe(true);
  });

  test('does not match commented-out spew calls', () => {
    expect(pattern.test('// spew.Dump(config)')).toBe(false);
    expect(pattern.test('  // pp.Println(result)')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes testdata directory', () => {
    expect(isFileExcluded('pkg/testdata/debug.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('internal/service.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_empty_error_check
// ============================================================================

describe('go_empty_error_check', () => {
  const { pattern, exclude } = slopPatterns.go_empty_error_check;

  test('matches if err != nil {}', () => {
    expect(pattern.test('if err != nil {}')).toBe(true);
  });

  test('matches with extra spacing', () => {
    expect(pattern.test('if err  !=  nil  {  }')).toBe(true);
  });

  test('does not match if err != nil with handler', () => {
    expect(pattern.test('if err != nil { return err }')).toBe(false);
  });

  test('does not match if err != nil with log', () => {
    expect(pattern.test('if err != nil { log.Fatal(err) }')).toBe(false);
  });

  test('severity is high', () => {
    expect(slopPatterns.go_empty_error_check.severity).toBe('high');
  });

  test('excludes test files', () => {
    expect(isFileExcluded('service_test.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('service.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_discarded_error
// ============================================================================

describe('go_discarded_error', () => {
  const { pattern, exclude } = slopPatterns.go_discarded_error;

  test('matches _ = doSomething()', () => {
    expect(pattern.test('_ = doSomething()')).toBe(true);
  });

  test('matches _ = os.Remove(path)', () => {
    expect(pattern.test('_ = os.Remove(path)')).toBe(true);
  });

  test('matches _ = file.Close()', () => {
    expect(pattern.test('_ = file.Close()')).toBe(true);
  });

  test('matches indented _ = file.Close()', () => {
    expect(pattern.test('\t_ = file.Close()')).toBe(true);
    expect(pattern.test('  _ = conn.Close()')).toBe(true);
  });

  test('does not match multi-return value, _ = func()', () => {
    // Multi-return where _ discards a bool or non-error value
    expect(pattern.test('value, _ = c.GetQuery(key)')).toBe(false);
    expect(pattern.test('head, tail, _ = strings.Cut(str, sep)')).toBe(false);
    expect(pattern.test('resp, _ = UnwrapResponse(rw)')).toBe(false);
  });

  test('does not match double-discard _, _ = func()', () => {
    // Both returns discarded deliberately
    expect(pattern.test('_, _ = fmt.Fprintf(w, "response")')).toBe(false);
    expect(pattern.test('_, _ = io.Copy(io.Discard, r.Body)')).toBe(false);
  });

  test('does not match for _, v := range', () => {
    expect(pattern.test('for _, v := range items {')).toBe(false);
  });

  test('does not match _, ok := m[key]', () => {
    expect(pattern.test('_, ok := m[key]')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('handler.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_bare_os_exit
// ============================================================================

describe('go_bare_os_exit', () => {
  const { pattern, exclude } = slopPatterns.go_bare_os_exit;

  test('matches os.Exit(1)', () => {
    expect(pattern.test('os.Exit(1)')).toBe(true);
  });

  test('matches os.Exit(0)', () => {
    expect(pattern.test('os.Exit(0)')).toBe(true);
  });

  test('does not match os.Exit in comments', () => {
    expect(pattern.test('// os.Exit(1).')).toBe(false);
    expect(pattern.test('// The logger then calls os.Exit(1).')).toBe(false);
    expect(pattern.test('  // FatalLevel logs a message, then calls os.Exit(1).')).toBe(false);
  });

  test('does not match os.Exitcode', () => {
    expect(pattern.test('code := os.Exitcode')).toBe(false);
  });

  test('excludes test files', () => {
    expect(isFileExcluded('main_test.go', exclude)).toBe(true);
  });

  test('excludes cmd directory', () => {
    expect(isFileExcluded('cmd/server/main.go', exclude)).toBe(true);
  });

  test('excludes main.go', () => {
    expect(isFileExcluded('main.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('internal/shutdown.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_empty_interface_param
// ============================================================================

describe('go_empty_interface_param', () => {
  const { pattern, exclude } = slopPatterns.go_empty_interface_param;

  test('matches func with interface{} param', () => {
    expect(pattern.test('func Process(data interface{}')).toBe(true);
  });

  test('matches func with mixed params including interface{}', () => {
    expect(pattern.test('func Handle(ctx context.Context, data interface{}')).toBe(true);
  });

  test('matches func with variadic interface{} param', () => {
    expect(pattern.test('func Log(args ...interface{}')).toBe(true);
  });

  test('does not match func without interface{}', () => {
    expect(pattern.test('func Process(data string)')).toBe(false);
  });

  test('does not match interface definition', () => {
    expect(pattern.test('type Handler interface {')).toBe(false);
  });

  test('severity is low', () => {
    expect(slopPatterns.go_empty_interface_param.severity).toBe('low');
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('handler.go', exclude)).toBe(false);
  });
});

// ============================================================================
// go_todo_empty_func
// ============================================================================

describe('go_todo_empty_func', () => {
  const { pattern, exclude } = slopPatterns.go_todo_empty_func;

  test('matches func with TODO comment', () => {
    expect(pattern.test('func Process(x int) error { // TODO implement')).toBe(true);
  });

  test('matches func with FIXME comment', () => {
    expect(pattern.test('func Handle(r *Request) { // FIXME')).toBe(true);
  });

  test('matches func with HACK comment', () => {
    expect(pattern.test('func Validate(s string) bool { // HACK')).toBe(true);
  });

  test('matches func with named return values', () => {
    expect(pattern.test('func Process() (result int, err error) { // TODO implement')).toBe(true);
  });

  test('matches func with multiple unnamed returns', () => {
    expect(pattern.test('func Get() (int, error) { // TODO')).toBe(true);
  });

  test('does not match func with real body', () => {
    expect(pattern.test('func Process(x int) error { return nil }')).toBe(false);
  });

  test('does not match func with TODO in body after code', () => {
    expect(pattern.test('func Process(x int) error { x++; // TODO add more')).toBe(false);
  });

  test('severity is high', () => {
    expect(slopPatterns.go_todo_empty_func.severity).toBe('high');
  });

  test('excludes test files', () => {
    expect(isFileExcluded('handler_test.go', exclude)).toBe(true);
  });

  test('excludes testdata directory', () => {
    expect(isFileExcluded('pkg/testdata/stub.go', exclude)).toBe(true);
  });

  test('does not exclude regular source files', () => {
    expect(isFileExcluded('internal/handler.go', exclude)).toBe(false);
  });
});
