---
name: deslop
description: "Use when user wants to clean AI slop from code. Use for cleanup, remove debug statements, find ghost code, repo hygiene."
version: 5.1.0
argument-hint: "[report|apply] [--scope=all|diff|path] [--thoroughness=quick|normal|deep]"
---

# deslop

Clean AI slop from code with certainty-based findings and auto-fixes.

## Parse Arguments

```javascript
const args = '$ARGUMENTS'.split(' ').filter(Boolean);
const mode = args.find(a => ['report', 'apply'].includes(a)) || 'report';
const scope = args.find(a => a.startsWith('--scope='))?.split('=')[1] || 'all';
const thoroughness = args.find(a => a.startsWith('--thoroughness='))?.split('=')[1] || 'normal';
```

## Input

Arguments: `[report|apply] [--scope=<path>|all|diff] [--thoroughness=quick|normal|deep]`

- **Mode**: `report` (default) or `apply`
- **Scope**: What to scan
  - `all` (default): Entire codebase
  - `diff`: Only files changed in current branch
  - `<path>`: Specific directory or file
- **Thoroughness**: Analysis depth (default: `normal`)
  - `quick`: Regex patterns only
  - `normal`: + multi-pass analyzers
  - `deep`: + CLI tools (jscpd, madge) if available

## Detection Pipeline

### Phase 0: Repo-Intel Targeting (Optional)

The `/deslop` command pre-fetches repo-intel data before spawning this skill and passes it as context. The pipeline library (`lib/collectors/codebase.js`) reads repo-intel automatically from the state directory - no agent action needed.

If repo-intel exists, the pipeline uses three signals to target and prioritize:
- **`recent-ai`** - target AI-written files instead of scanning everything
- **`test-gaps`** - escalate MEDIUM findings in untested files to HIGH
- **`diff-risk`** - attach risk scores for sorting within certainty tiers

**How these signals are used downstream:**
- `aiTargetFiles`: Pipeline selects these files automatically in `runPipeline()`
- `testGapSet`: Applied inside `runPipeline()` after Phase 1 and Phase 2
- `riskScores`: Applied inside `runPipeline()` for sorting

### Phase 1: Run Detection Script

The detection script is at `../../scripts/detect.js` relative to this skill.

**Run detection** (use relative path from skill directory):
```bash
# If aiTargetFiles is available from Phase 0, pass them explicitly:
# node ../../scripts/detect.js file1.ts file2.ts --compact
# Otherwise scan everything:
node ../../scripts/detect.js . --compact --max 50
```

**For deep thoroughness** (includes CLI tools if available):
```bash
node ../../scripts/detect.js . --deep --compact --max 50
```

**For diff scope** (only changed files):
```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@' || echo "main")
# Use newline-separated list to safely handle filenames with special chars
git diff --name-only origin/${BASE}..HEAD | \
  xargs -d '\n' node ../../scripts/detect.js --compact
```

**Note**: The relative path `../../scripts/detect.js` navigates from `skills/deslop/` up to the plugin root where `scripts/` lives.

### Phase 2: Risk Weighting (Repo-Intel)

The pipeline automatically reads repo-intel data from `lib/collectors/codebase.js` (no agent action required). If repo-intel exists in the state directory, findings are enriched:

- **test-gaps**: MEDIUM findings in files with no test coupling are escalated to HIGH
- **diff-risk**: Risk scores attached to findings for sorting within certainty tiers

This happens inside `runPipeline()` - the skill does not need to query repo-intel directly.

### Phase 3: Aggregate and Prioritize

Sort findings by:
1. **Certainty**: HIGH before MEDIUM before LOW
2. **Risk score**: higher riskScore first within same certainty
3. **Severity**: high before medium before low
4. **Fix complexity**: auto-fixable before manual

### Phase 4: Return Structured Results

Skill returns structured JSON - does NOT apply fixes (orchestrator handles that).

## Output Format

JSON structure between markers:

```
=== DESLOP_RESULT ===
{
  "mode": "report|apply",
  "scope": "all|diff|path",
  "filesScanned": N,
  "findings": [
    {
      "file": "src/api.js",
      "line": 42,
      "pattern": "debug-statement",
      "message": "console.log found",
      "certainty": "HIGH",
      "severity": "medium",
      "autoFix": true,
      "fixType": "remove-line"
    }
  ],
  "fixes": [
    {
      "file": "src/api.js",
      "line": 42,
      "fixType": "remove-line",
      "pattern": "debug-statement"
    }
  ],
  "summary": {
    "high": N,
    "medium": N,
    "low": N,
    "autoFixable": N
  }
}
=== END_RESULT ===
```

## Certainty Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **HIGH** | Definitely slop, safe to auto-fix | Auto-fix via simple-fixer |
| **MEDIUM** | Likely slop, needs verification | Review first |
| **LOW** | Possible slop, context-dependent | Flag only |

## Pattern Categories

### HIGH Certainty (Auto-Fixable)

- `debug-statement`: console.log, console.debug, print, println!
- `debug-import`: Unused debug/logging imports
- `placeholder-text`: "Lorem ipsum", "TODO: implement"
- `empty-catch`: Empty catch blocks without comment
- `trailing-whitespace`: Trailing whitespace
- `mixed-indentation`: Mixed tabs/spaces

### MEDIUM Certainty (Review Required)

- `excessive-comments`: Comment/code ratio > 2:1
- `doc-code-ratio`: JSDoc > 3x function body
- `stub-function`: Returns placeholder value only
- `dead-code`: Unreachable after return/throw
- `infrastructure-without-impl`: DB clients created but never used

### LOW Certainty (Flag Only)

- `over-engineering`: File/export ratio > 20x
- `buzzword-inflation`: Claims without evidence
- `shotgun-surgery`: Files frequently change together

## Fix Types

These correspond to the `autoFix` values emitted by slop-patterns:

| AutoFix Strategy | Action | Patterns |
|-----------------|--------|----------|
| `remove` | Delete line | debug-statement, debug-import, placeholder-text |
| `add_logging` | Add proper error logging | empty-catch |
| `replace` | Replace with corrected code | mixed-indentation |

## Error Handling

- **Git not available**: Skip git-dependent checks
- **Invalid scope**: Return error in JSON
- **Parse errors**: Skip file, continue scan

## Integration

This skill is invoked by:
- `deslop-agent` for `/deslop` command
- `/next-task` Phase 8 (pre-review gates) with `scope=diff`

The orchestrator spawns `simple-fixer` to apply HIGH certainty fixes.


## Repo-Intel Data

**Expected:** the orchestrator (the command that spawned this agent) has already checked `<stateDir>/repo-intel.json` and either pre-fetched the data into your context or skipped (user declined to generate). **Do not call `AskUserQuestion` here** - subagents cannot interact with the user.

**If the pre-fetched data is empty**, proceed with the available context. The orchestrator has already made the decision on the user's behalf.

**Binary:** `agent-analyzer` auto-downloads to `~/.agent-sh/bin/` from `agent-sh/agent-analyzer` GitHub releases (~10 MB) on first use. The `lib/agentsys` resolver locates the agentsys install (CC marketplace clone, npm global, or sibling repo).

