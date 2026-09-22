import { describe, expect, it } from 'vitest';

import {
  closeRunLedgerV2,
  createRunLedgerV2,
} from '../../scripts/agents/run-ledger-v2.mjs';

// Kept before the OBSERVED_V1 cutoff (2026-09-15) so these fixtures score
// through the simpler LEGACY_V2 path in score-run-v2.mjs rather than needing
// a full modelUsage.tasks observed-event stream too.
const STARTED_AT = '2026-09-05T01:00:00Z';
const ENDED_AT = '2026-09-05T02:00:00Z';

function baseCloseoutArgs(): any {
  return {
    status: 'COMPLETE',
    endedAt: ENDED_AT,
    mainEndSha: 'b'.repeat(40),
    openIssuesEnd: 10,
    openPrsEnd: 2,
    evidenceRef: 'github:issue#193',
  };
}

function createV4Run(): any {
  return createRunLedgerV2(
    '2026-09-05-closeout-grading-preflight',
    STARTED_AT,
    { closeoutOwner: 'GOVERNANCE_MAIN_SESSION' },
  );
}

// Fully legal completionTruth + legacy percent fields, so the candidate is
// actually gradeable (GRADED_V2) once closed.
function makeFullyGradeableRun(): any {
  const run = createV4Run();
  run.delivery.issuesClosed = 1;
  run.completionTruth = {
    status: 'VERIFIED',
    checkedAt: ENDED_AT,
    claims: [
      {
        type: 'ISSUE_CLOSED',
        subject: '#650',
        claimedState: 'closed',
        observedState: 'closed',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'SOURCE_VERIFIED',
        subject: '#650',
        claimedState: 'success',
        observedState: 'success',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'MERGED_TO_MAIN',
        subject: '#650',
        claimedState: 'merged',
        observedState: 'merged',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'AUTO_VERCEL_DEPLOYED',
        subject: '#650',
        claimedState: 'ready',
        observedState: 'ready',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'PRODUCTION_SCHEMA_READY',
        subject: '#650',
        claimedState: 'not_required',
        observedState: 'not_required',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'AUTHENTICATED_PRODUCTION_ACCEPTED',
        subject: '#650',
        claimedState: 'accepted',
        observedState: 'accepted',
        evidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/650',
        verification: 'VERIFIED',
      },
      {
        type: 'RUN_COMPLETE',
        subject: 'run',
        claimedState: 'complete',
        observedState: 'complete',
        evidenceRef: 'github:issue#193',
        verification: 'VERIFIED',
      },
    ],
  };
  run.modelUsage.weightedUsageImprovementPercent = 0;
  run.ci.firstPassRatePercent = 100;
  run.quality.acceptanceEvidenceCoveragePercent = 100;
  run.quality.auditFirstPassRatePercent = 100;
  run.flow.lunaDelegationRatePercent = 0;
  run.flow.waitTimeConvertedPercent = 0;
  run.auditability.evidenceFieldsCompletePercent = 100;
  run.auditability.exactHeadTestCoveragePercent = 100;
  run.auditability.preciseBlockersPercent = 100;
  run.auditability.scoreInputsCompletePercent = 100;
  return run;
}

describe('closeRunLedgerV2 grading preflight', () => {
  it('fails closed on a COMPLETE Run whose completionTruth would score NOT_GRADED', () => {
    const run = createV4Run();
    expect(() => closeRunLedgerV2(run, baseCloseoutArgs())).toThrow(/CLOSEOUT_WOULD_NOT_GRADE/);
    try {
      closeRunLedgerV2(run, baseCloseoutArgs());
      expect.unreachable();
    } catch (error: any) {
      expect(error.message).toContain('completionTruth.status must be VERIFIED');
      expect(error.message).toContain('verified RUN_COMPLETE claim is required');
    }
  });

  it('closes knowingly and records a note when a legitimate --accept-not-graded reason is given', () => {
    const run = createV4Run();
    const candidate = closeRunLedgerV2(run, {
      ...baseCloseoutArgs(),
      acceptNotGraded: 'Completion Truth 尚未補齊，Owner 已同意先關帳並留待複盤',
    });
    expect(candidate.closeout.state).toBe('CLOSED');
    const note = candidate.notes.find((item: string) => item.startsWith('CLOSEOUT_ACCEPTED_NOT_GRADED:'));
    expect(note).toBeDefined();
    expect(note).toContain('Completion Truth 尚未補齊');
    expect(note).toContain('completionTruth.status must be VERIFIED');
  });

  it.each(['', '   ', 'none', 'None', 'n/a', 'N/A', 'tbd', 'TBD', '-'])(
    'rejects a placeholder --accept-not-graded reason %j',
    (reason) => {
      const run = createV4Run();
      expect(() => closeRunLedgerV2(run, {
        ...baseCloseoutArgs(),
        acceptNotGraded: reason,
      })).toThrow(/CLOSEOUT_WOULD_NOT_GRADE/);
    },
  );

  it('closes normally without throwing when completionTruth is fully verified and gradeable', () => {
    const run = makeFullyGradeableRun();
    const candidate = closeRunLedgerV2(run, baseCloseoutArgs());
    expect(candidate.closeout.state).toBe('CLOSED');
    expect(candidate.notes).toEqual([]);
  });

  it('does not gate a BASELINE Run even when completionTruth has gaps', () => {
    const run = createV4Run();
    const candidate = closeRunLedgerV2(run, { ...baseCloseoutArgs(), status: 'BASELINE' });
    expect(candidate.status).toBe('BASELINE');
    expect(candidate.closeout.state).toBe('CLOSED');
    expect(candidate.notes).toEqual([]);
  });

  it('does not gate an OWNER_BLOCKED Run even when completionTruth has gaps', () => {
    const run = createV4Run();
    const candidate = closeRunLedgerV2(run, { ...baseCloseoutArgs(), status: 'OWNER_BLOCKED' });
    expect(candidate.status).toBe('OWNER_BLOCKED');
    expect(candidate.closeout.state).toBe('CLOSED');
    expect(candidate.notes).toEqual([]);
  });
});
