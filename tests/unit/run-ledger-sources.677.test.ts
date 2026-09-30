import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHistoricalRunLedgerV3, createRunLedgerV2, validateRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { validateProductRunContent } from '../../scripts/agents/scorecard-required-gate.mjs';
import { analyzeScorecardReadiness } from '../../scripts/agents/scorecard-readiness.mjs';

const id = '2026-09-30-sources-677';
const body = `<!-- pr-lifecycle
issue: 677
state: ACTIVE
supersedes: none
-->
WORKSTREAM: PRODUCT_MAINLINE
RUN_ID: ${id}
SCORECARD_PATH: docs/metrics/agent-runs/${id}.json
`;
function fixture(): any {
  const run: any = createRunLedgerV2(id, '2026-09-30T06:00:00Z', { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
  run.delivery.issuesStarted = 1;
  run.modelUsage.tasks.push({ id: 'observed', requestedModel: 'luna', actualModel: 'unknown', role: 'fixture',
    count: 1, contextClass: 'compact', accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null });
  run.flow.lunaTasks = 1;
  run.flow.lunaAccepted = 1;
  return run;
}

describe('#677 shared operational sources validation', () => {
  it.each(['IN_PROGRESS', 'CLOSURE_RECOVERY'])('rejects malformed elements in %s before binding without throwing', status => {
    for (const source of ['issue/677', null, [], 7, {}, { ref: '' }, { ref: '  ' }, { ref: 677 }]) {
      const run = fixture();
      run.status = status;
      run.sources = [source];
      const errors = validateRunLedgerV2(run);
      expect(errors.join('\n')).toMatch(/sources\[0\].*(object|non-empty string)/);
      expect(analyzeScorecardReadiness(run).validationErrors).toEqual(errors);
      expect(validateProductRunContent(body, JSON.stringify(run)).join('\n')).toContain(errors[0]);
    }
  });

  it('accepts object refs with optional metadata while retaining exact issue binding', () => {
    const run = fixture();
    run.sources = [{ ref: 'origin/main', kind: 'baseline' }, { ref: 'issue/677' }];
    expect(validateRunLedgerV2(run)).toEqual([]);
    expect(validateProductRunContent(body, JSON.stringify(run))).toEqual([]);
    run.sources[1].ref = 'issue/6770';
    expect(validateRunLedgerV2(run)).toEqual([]);
    expect(validateProductRunContent(body, JSON.stringify(run)).join('\n')).toContain('exact issue/677');
    run.sources[1].ref = ' issue/677 ';
    expect(validateProductRunContent(body, JSON.stringify(run)).join('\n')).toContain('exact issue/677');
  });

  it('allows empty initial sources but binding still requires the exact issue', () => {
    const run = fixture();
    expect(validateRunLedgerV2(run)).toEqual([]);
    expect(validateProductRunContent(body, JSON.stringify(run)).join('\n')).toContain('exact issue/677');
    run.sources = 'issue/677';
    expect(validateRunLedgerV2(run)).toContain('sources must be an array');
  });

  it('replays the existing closed v4 string sources without mutation; reopening restores strict validation', () => {
    const bytes = fs.readFileSync('docs/metrics/agent-runs/2026-09-08-product-delivery-r02.json', 'utf8');
    const run = JSON.parse(bytes);
    const before = JSON.stringify(run);
    expect(run.sources.every((source: unknown) => typeof source === 'string')).toBe(true);
    expect(validateRunLedgerV2(run)).toEqual([]);
    expect(JSON.stringify(run)).toBe(before);
    expect(validateProductRunContent(body, JSON.stringify(run)).join('\n')).toContain('historical/closed');
    run.status = 'CLOSURE_RECOVERY';
    run.closeout = fixture().closeout;
    expect(validateRunLedgerV2(run).join('\n')).toContain('sources[0] must be an object');
  });

  it('preserves historical v3 reproduction', () => {
    const run: any = createHistoricalRunLedgerV3(id, '2026-09-30T06:00:00Z');
    run.sources = ['github:issue#677'];
    expect(validateRunLedgerV2(run)).toEqual([]);
  });
});
