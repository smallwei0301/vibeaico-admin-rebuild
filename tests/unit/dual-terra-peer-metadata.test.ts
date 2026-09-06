import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  attachActualChangedFiles,
  parseLaneMetadata,
  pilotCapacity,
  summarizeActiveLanes,
  validateActualFileOwnership,
  validateGlobalWip,
  validateLaneMetadata,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

const runId = '2026-09-02-dual-pilot-r01';

function pilotPr(number: number, issue: number, slot: number, active: boolean, ownership: string) {
  return {
    number,
    state: 'open',
    body: `<!-- pr-lifecycle
issue: ${issue}
state: ACTIVE
supersedes:
-->
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: ${runId}
- SCORECARD_PATH: docs/metrics/agent-runs/${runId}.json
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: ${active}
- CLOSEABILITY_SCORE: 4
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: local test, canonical test, audit and merge
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: REPORT:docs/metrics/agent-runs/${runId}.json
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: true
- TERRA_SLOT: ${slot}
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: AUTO_PR_${number}
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: ${ownership}`,
  };
}

describe('dual Terra peer validation', () => {
  it('revalidates the existing peer and normalizes declared ownership before unlocking slot two', () => {
    const summary = summarizeActiveLanes([
      pilotPr(20, 120, 1, false, './src//app/api/**'),
      pilotPr(21, 121, 2, true, 'src/app/api/chat'),
    ]);
    const errors = validateGlobalWip(summary);

    expect(errors).toContain(
      'Active Terra PR #20: An active TERRA_BUILD must set ACTIVE_CANDIDATE=true',
    );
    expect(errors.some((error) => error.includes('Dual Terra FILE_OWNERSHIP overlaps'))).toBe(true);
    expect(pilotCapacity(summary).qualified).toBe(false);
  });

  it.each(['*', './', '/**', ',,', '/src/app', 'C:\\src\\app', '../src/app', 'src/*/app'])(
    'rejects ownership that is empty, absolute, traversing, or ambiguous: %s',
    (ownership) => {
      const metadata = parseLaneMetadata(pilotPr(20, 120, 1, true, ownership));

      expect(validateLaneMetadata(metadata)).toContain(
        'Dual Terra FILE_OWNERSHIP must use normalized repository-relative paths',
      );
    },
  );

  it('normalizes an internal dot segment before checking overlap', () => {
    const summary = summarizeActiveLanes([
      pilotPr(20, 120, 1, true, 'src/./app/api'),
      pilotPr(21, 121, 2, true, 'src/app/api/chat'),
    ]);

    expect(validateGlobalWip(summary).some((error) => error.includes('Dual Terra FILE_OWNERSHIP overlaps'))).toBe(true);
  });

  it('accepts the two real pilot shapes when every GitHub changed file is declared', () => {
    const bookingFiles = [
      'src/app/api/bookings/[id]/route.ts',
      'src/app/tenant/bookings/page.tsx',
      'src/i18n/zh-TW/pages/bookings.ts',
      'src/services/bookings.ts',
      'tests/unit/booking-modified-wiring.27.test.ts',
    ];
    const bugReportFiles = [
      'src/app/api/bug-report/route.ts',
      'src/components/layout/BugReportModal.tsx',
      'src/i18n/zh-TW/common.ts',
      'src/services/bug-report.ts',
      'tests/unit/bug-report-submit-wiring.28.test.ts',
    ];
    const summary = attachActualChangedFiles(
      summarizeActiveLanes([
        pilotPr(20, 27, 1, true, bookingFiles.join(', ')),
        pilotPr(21, 28, 2, true, bugReportFiles.join(', ')),
      ]),
      { 20: bookingFiles, 21: bugReportFiles },
    );

    expect(validateGlobalWip(summary)).toEqual([]);
    expect(pilotCapacity(summary)).toEqual({ terraMax: 2, reserveMax: 0, qualified: true });
  });

  it('allows a declared directory root to cover its actual descendant files', () => {
    const metadata = parseLaneMetadata(
      pilotPr(20, 120, 1, true, 'src/app/api/bookings, tests/unit'),
    );

    expect(validateActualFileOwnership(metadata, [
      'src/app/api/bookings/[id]/route.ts',
      'tests/unit/booking-modified-wiring.27.test.ts',
    ])).toEqual([]);
  });

  it('fails closed when GitHub actual changed files were not loaded', () => {
    const summary = attachActualChangedFiles(
      summarizeActiveLanes([
        pilotPr(20, 120, 1, true, 'src/app/api/bookings'),
        pilotPr(21, 121, 2, true, 'src/app/api/bug-report'),
      ]),
      { 20: ['src/app/api/bookings/[id]/route.ts'] },
    );

    expect(validateGlobalWip(summary)).toContain(
      'Dual Terra PR #21 actual changed-file list was not loaded',
    );
    expect(pilotCapacity(summary).qualified).toBe(false);
  });

  it('rejects an actual changed file that was omitted from FILE_OWNERSHIP', () => {
    const summary = attachActualChangedFiles(
      summarizeActiveLanes([
        pilotPr(20, 120, 1, true, 'src/app/api/bookings'),
        pilotPr(21, 121, 2, true, 'src/app/api/bug-report'),
      ]),
      {
        20: [
          'src/app/api/bookings/[id]/route.ts',
          'src/services/bookings.ts',
        ],
        21: ['src/app/api/bug-report/route.ts'],
      },
    );

    expect(validateGlobalWip(summary)).toContain(
      'Dual Terra PR #20 changed files outside FILE_OWNERSHIP: src/services/bookings.ts',
    );
    expect(pilotCapacity(summary).qualified).toBe(false);
  });

  it('rejects overlapping actual GitHub diffs even when metadata is also malformed', () => {
    const sharedFile = 'src/services/shared.ts';
    const summary = attachActualChangedFiles(
      summarizeActiveLanes([
        pilotPr(20, 120, 1, true, 'src/services'),
        pilotPr(21, 121, 2, true, 'src/services/shared.ts'),
      ]),
      { 20: [sharedFile], 21: [sharedFile] },
    );

    const errors = validateGlobalWip(summary);
    expect(errors.some((error) => error.includes('Dual Terra FILE_OWNERSHIP overlaps'))).toBe(true);
    expect(errors).toContain(`Dual Terra actual changed files overlap: ${sharedFile}`);
    expect(pilotCapacity(summary).qualified).toBe(false);
  });

  it('includes both new and previous GitHub filenames when a file is renamed', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'),
      'utf8',
    );

    expect(workflow).toContain(
      "files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean))",
    );
  });

  it('fails closed when two renames share the same previous filename', () => {
    const previousFile = 'src/services/shared.ts';
    const summary = attachActualChangedFiles(
      summarizeActiveLanes([
        pilotPr(20, 120, 1, true, 'src/services/booking.ts'),
        pilotPr(21, 121, 2, true, 'src/services/bug-report.ts'),
      ]),
      {
        20: ['src/services/booking.ts', previousFile],
        21: ['src/services/bug-report.ts', previousFile],
      },
    );

    const errors = validateGlobalWip(summary);
    expect(errors).toContain(`Dual Terra actual changed files overlap: ${previousFile}`);
    expect(pilotCapacity(summary).qualified).toBe(false);
  });
});
