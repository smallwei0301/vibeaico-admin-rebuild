import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  execution: fs.readFileSync('docs/AGENT-EXECUTION.md', 'utf8'),
  protocol: fs.readFileSync('docs/RETROSPECTIVE-PROTOCOL.md', 'utf8'),
  skill: fs.readFileSync('.agents/skills/vibeaico-agent-retrospective/SKILL.md', 'utf8'),
};

describe('#652 retrospective execution receipt', () => {
  it('keeps AGENT-EXECUTION as the only daily entry and makes the receipt mandatory everywhere', () => {
    for (const text of Object.values(files)) {
      expect(text).toContain('RETROSPECTIVE_EXECUTION_RECEIPT_REQUIRED');
    }
    expect(files.skill).toContain('`docs/AGENT-EXECUTION.md` is the sole canonical');
    expect(files.protocol).toContain('實際 Agent 執行規則仍以 `docs/AGENT-EXECUTION.md` 為準');
  });

  it('requires actual Product scoring execution rather than manual ledger inspection', () => {
    for (const command of [
      'run-ledger-v2.mjs',
      'scorecard-readiness.mjs',
      'score-run-current.mjs',
      'review-runs-v2.mjs',
    ]) {
      expect(files.execution).toContain(command);
      expect(files.protocol).toContain(command);
      expect(files.skill).toContain(command);
    }
  });

  it('requires both formal Governance scoring and exact-window current observation', () => {
    for (const command of ['governance-scoreboard.mjs', 'governance-observation.mjs']) {
      expect(files.execution).toContain(command);
      expect(files.protocol).toContain(command);
      expect(files.skill).toContain(command);
    }
  });

  it('fails the definition of complete retrospective when mandatory execution is missing', () => {
    for (const text of Object.values(files)) {
      expect(text).toContain('PARTIAL_RETROSPECTIVE');
    }
    expect(files.execution).toContain('COMMAND / INPUT / TERMINAL_RESULT_OR_EXIT / OUTPUT_OR_EVIDENCE_REF / OBSERVED_MAIN');
  });
});
