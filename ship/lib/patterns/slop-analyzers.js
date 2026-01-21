/**
 * Slop Analyzers - Multi-pass analysis functions for slop detection
 *
 * These analyzers handle patterns that require structural code analysis
 * beyond simple regex matching (e.g., doc/code ratio computation).
 *
 * @author Avi Fenesh
 * @license MIT
 */

/**
 * Analyze JSDoc-to-function ratio to detect excessive documentation
 *
 * Flags functions where JSDoc block lines exceed maxRatio times the function body lines.
 * This pattern often indicates AI-generated code with verbose, unnecessary documentation.
 *
 * @param {string} content - File content to analyze
 * @param {Object} options - Analysis options
 * @param {number} [options.minFunctionLines=3] - Minimum function body lines to analyze
 * @param {number} [options.maxRatio=3.0] - Maximum allowed doc/code ratio
 * @returns {Array<Object>} Array of violations: { line, docLines, codeLines, ratio }
 */
function analyzeDocCodeRatio(content, options = {}) {
  const minFunctionLines = options.minFunctionLines || 3;
  const maxRatio = options.maxRatio || 3.0;
  const violations = [];

  // Regex to match JSDoc block followed by any function declaration
  // Captures: /** ... */ then finds the next opening brace
  // Handles: function name(), async function name(), export function, const name = () =>
  const jsdocPattern = /\/\*\*([\s\S]*?)\*\/\s*(export\s+)?(async\s+)?(?:function\s+\w+\s*\([^)]*\)|const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;

  let match;
  while ((match = jsdocPattern.exec(content)) !== null) {
    const jsdocBlock = match[1];
    const jsdocLines = countNonEmptyLines(jsdocBlock);

    // Find the opening brace after the match
    const afterMatch = match.index + match[0].length;
    const openBraceOffset = content.substring(afterMatch).search(/\{/);
    if (openBraceOffset === -1) continue; // No opening brace found

    const funcStart = afterMatch + openBraceOffset;
    const closingBraceIndex = findMatchingBrace(content, funcStart);

    if (closingBraceIndex === -1) continue; // Parsing failed, skip

    const funcBody = content.substring(funcStart + 1, closingBraceIndex);
    const funcLines = countNonEmptyLines(funcBody);

    // Skip if function is too small
    if (funcLines < minFunctionLines) continue;

    const ratio = jsdocLines / funcLines;
    if (ratio > maxRatio) {
      // Line number is 1-indexed: count newlines before match + 1
      const lineNumber = countNewlines(content.substring(0, match.index)) + 1;
      violations.push({
        line: lineNumber,
        docLines: jsdocLines,
        codeLines: funcLines,
        ratio: parseFloat(ratio.toFixed(2))
      });
    }
  }

  return violations;
}

/**
 * Count non-empty lines in a string
 * @param {string} str - String to count lines in
 * @returns {number} Number of non-empty lines
 */
function countNonEmptyLines(str) {
  return str.split('\n').filter(line => line.trim().length > 0).length;
}

/**
 * Count newlines in a string (for line number calculation)
 * @param {string} str - String to count newlines in
 * @returns {number} Number of newlines (lines - 1 for content before position)
 */
function countNewlines(str) {
  if (!str) return 0;
  return (str.match(/\n/g) || []).length;
}

/**
 * Find matching closing brace (handles nested braces and string literals)
 *
 * Stops at 5000 characters to prevent runaway parsing on malformed code.
 *
 * @param {string} content - Full file content
 * @param {number} openIndex - Index of opening brace
 * @returns {number} Index of matching closing brace, or -1 if not found
 */
function findMatchingBrace(content, openIndex) {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  let inTemplateExpr = false;
  let templateExprDepth = 0;

  // Limit search to prevent runaway parsing
  const maxSearch = Math.min(content.length, openIndex + 5000);

  for (let i = openIndex + 1; i < maxSearch; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';

    // Handle template literal expression ${...}
    if (char === '$' && content[i + 1] === '{' && inString && stringChar === '`') {
      inTemplateExpr = true;
      templateExprDepth = 1;
      i++; // Skip the {
      continue;
    }

    // Inside template expression, track braces separately
    if (inTemplateExpr) {
      if (char === '{') {
        templateExprDepth++;
      } else if (char === '}') {
        templateExprDepth--;
        if (templateExprDepth === 0) {
          inTemplateExpr = false;
        }
      }
      continue;
    }

    // Track string state (handle escaped quotes)
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
      } else if (!inString) {
        inString = true;
        stringChar = char;
      }
      continue;
    }

    // Count braces outside strings
    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0) return i;
    }
  }

  return -1; // Not found within limit
}

module.exports = {
  analyzeDocCodeRatio,
  // Export helpers for testing
  findMatchingBrace,
  countNonEmptyLines
};
