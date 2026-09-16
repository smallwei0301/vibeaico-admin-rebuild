import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/agent-run-scorecard.yml', 'utf8');

describe('#531 agent-run-scorecard live readiness gate', () => {
  it('fetches enough git history to prove which ledger changed', () => {
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain("git diff --name-only \"$base_sha\" \"$GITHUB_SHA\" -- 'docs/metrics/agent-runs/*.json'");
  });

  it('runs strict-live only for changed active schema-v2 ledgers', () => {
    expect(workflow).toContain('Strict live readiness for changed active v2 ledgers');
    expect(workflow).toContain('[ "$schema_version" = "2" ] && [ "$status" = "IN_PROGRESS" ]');
    expect(workflow).toContain('node scripts/agents/scorecard-readiness.mjs "$ledger" --strict-live');
  });

  it('does not silently treat an unprovable diff base as healthy', () => {
    expect(workflow).toContain('No stable comparison base; no changed-ledger strict-live check can be proven.');
    expect(workflow).toContain('exit 1');
  });

  it('watches future readiness and workflow changes', () => {
    expect(workflow).toContain("- 'scripts/agents/scorecard-readiness.mjs'");
    expect(workflow).toContain("- '.github/workflows/agent-run-scorecard.yml'");
    expect(workflow).toContain("- 'tests/unit/scorecard-live-workflow*.test.ts'");
  });
});
