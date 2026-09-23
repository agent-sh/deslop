#!/usr/bin/env node
/**
 * Slop Detection CLI
 * Runs the detection pipeline and outputs structured findings
 *
 * Usage: node detect.js [path] [file ...] [--files-from FILE|-] [--apply] [--deep] [--compact]
 */

const path = require('path');
const fs = require('fs');

// Resolve lib relative to script location (works with ${CLAUDE_PLUGIN_ROOT})
const libPath = path.join(__dirname, '..', 'lib');
const { runPipeline } = require(path.join(libPath, 'patterns', 'pipeline'));

function parseArgs(args) {
  const options = {
    path: '.',
    mode: 'report',
    thoroughness: 'normal',
    compact: false,
    maxFindings: 10,
    files: [],
    filesFrom: null
  };
  let sawPath = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') {
      options.mode = 'apply';
    } else if (arg === '--deep') {
      options.thoroughness = 'deep';
    } else if (arg === '--quick') {
      options.thoroughness = 'quick';
    } else if (arg === '--compact') {
      options.compact = true;
    } else if (arg === '--max' && args[i + 1]) {
      options.maxFindings = parseInt(args[++i], 10);
    } else if (arg === '--files-from' && args[i + 1]) {
      options.filesFrom = args[++i];
    } else if (!arg.startsWith('-')) {
      // First positional is the repo path; the rest are files inside it to scan.
      if (sawPath) options.files.push(arg);
      else { options.path = arg; sawPath = true; }
    }
  }

  return options;
}

function formatFindings(result, compact, maxFindings = 10) {
  // Handle pipeline output format (has 'findings' array or 'summary' object)
  const findings = result.findings || [];
  const summary = result.summary || {};

  if (compact) {
    // Compact table format for token efficiency
    console.log('\n## Slop Detection Results\n');
    console.log('| File | Line | Pattern | Severity | Certainty |');
    console.log('|------|------|---------|----------|-----------|');

    for (const finding of findings.slice(0, maxFindings)) {
      const file = (finding.file || finding.path || '').length > 30
        ? '...' + (finding.file || finding.path || '').slice(-27)
        : (finding.file || finding.path || '');
      const line = finding.line || finding.lineNumber || '-';
      const pattern = finding.patternName || finding.pattern || finding.type || 'unknown';
      const severity = finding.severity || 'medium';
      const certainty = finding.certainty || 'MEDIUM';
      console.log(`| ${file} | ${line} | ${pattern} | ${severity} | ${certainty} |`);
    }

    const total = summary.totalFindings || findings.length;
    const bySeverity = summary.bySeverity || {};
    console.log(`\n**Total**: ${total} findings`);
    console.log(`**By Severity**: critical=${bySeverity.critical || 0}, high=${bySeverity.high || 0}, medium=${bySeverity.medium || 0}, low=${bySeverity.low || 0}`);
  } else {
    // Full JSON output
    console.log(JSON.stringify(result, null, 2));
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Slop Detection CLI

Usage: node detect.js [path] [file ...] [options]

  With files after the path (relative to it), only those files are scanned.
  Without them, up to 200 source files are scanned (tests excluded), or the
  repo-intel slop targets when a map exists.

Options:
  --files-from F  Read files to scan, one per line, from F ('-' for stdin)
  --apply      Apply auto-fixes (default: report only)
  --deep       Deep analysis with all analyzers
  --quick      Quick regex-only scan
  --compact    Output as markdown table (token efficient)
  --max N      Maximum findings to return (default: 10)
  --help       Show this help

Examples:
  node detect.js                    # Scan current directory
  node detect.js src/               # Scan src/ directory
  git diff --name-only main... | node detect.js . --files-from -   # Scan changed files
  node detect.js --apply --compact  # Fix and show compact results
`);
    process.exit(0);
  }

  const options = parseArgs(args);

  // Validate path exists
  if (!fs.existsSync(options.path)) {
    console.error(`Error: Path not found: ${options.path}`);
    process.exit(1);
  }

  try {
    // Pull analyzer-supplied slop signals when repo-intel exists. Both
    // helpers return null if the analyzer / artifact are unavailable;
    // the pipeline degrades to its scan-everything default in that case.
    let analyzerFixes = [];
    let analyzerTargetFiles = null;
    try {
      const signals = require(path.join(libPath, '..', 'lib', 'repo-intel-signals'));
      const fixesResult = signals.getSlopFixes(options.path);
      if (fixesResult && Array.isArray(fixesResult.fixes)) {
        analyzerFixes = fixesResult.fixes
          .map(signals.toDeslopFix)
          .filter(Boolean);
      }
      const targetsResult = signals.getSlopTargets(options.path, { top: 30 });
      const list = signals.targetsToFileList(targetsResult);
      if (list.length > 0) analyzerTargetFiles = list;
    } catch (e) {
      // Module load failure: continue without analyzer signals.
    }

    // Explicit files win over the analyzer's targets: the caller asked for exactly these.
    let explicitFiles = options.files.slice();
    if (options.filesFrom) {
      const text = fs.readFileSync(options.filesFrom === '-' ? 0 : options.filesFrom, 'utf8');
      explicitFiles = explicitFiles.concat(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    }
    explicitFiles = explicitFiles.filter(f => fs.existsSync(path.join(options.path, f)));

    if ((options.files.length > 0 || options.filesFrom) && explicitFiles.length === 0) {
      formatFindings({ findings: [], summary: { total: 0, bySeverity: {} } }, options.compact, options.maxFindings);
      return;
    }

    // runPipeline takes (repoPath, options) - async function
    const result = await runPipeline(options.path, {
      mode: options.mode,
      thoroughness: options.thoroughness,
      targetFiles: explicitFiles.length > 0 ? explicitFiles : (analyzerTargetFiles || undefined)
    });

    // Merge analyzer fixes into the result up front so consumers see a
    // single unified list. Tag each entry with `source` for traceability.
    if (analyzerFixes.length > 0) {
      result.fixes = (analyzerFixes).concat(result.fixes || []);
      result.summary = result.summary || {};
      result.summary.analyzerSuppliedFixes = analyzerFixes.length;
    }

    formatFindings(result, options.compact, options.maxFindings);

    // Exit with error code if critical findings
    const bySeverity = result.summary?.bySeverity || {};
    if (bySeverity.critical > 0) {
      process.exit(2);
    }
  } catch (error) {
    console.error(`Error running detection: ${error.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
