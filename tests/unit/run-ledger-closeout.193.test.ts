import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createRunLedgerV2,
  RUN_CLOSEOUT_TERMINAL_POLICY,
  runCli,
  validateRunLedgerV2,
} from '../../scripts/agents/run-ledger-v2.mjs';

const STARTED_AT = '2026-09-05T01:00:00Z';
const ENDED_AT = '2026-09-05T02:00:00Z';

function createV4Run(): any {
  return createRunLedgerV2(
    '2026-09-05-closeout-contract-test',
    STARTED_AT,
    { closeoutOwner: 'PRODUCT_MAIN_SESSION' },
  );
}

function closeRun(run: any): any {
  run.status = 'COMPLETE';
  run.endedAt = ENDED_AT;
  run.main.endSha = 'b'.repeat(40);
  run.inventory.openIssuesEnd = 10;
  run.inventory.openPrsEnd = 2;
  run.closeout.state = 'CLOSED';
  run.closeout.closedAt = ENDED_AT;
  run.closeout.evidenceRef = 'github:issue#193';
  return run;
}

describe('Issue #193 Run closeout contract', () => {
  it('preserves historical v3 construction for old tests and ledgers', () => {
    const historical: any = createRunLedgerV2('2026-09-02-historical-v3', STARTED_AT);
    expect(historical.deliveryTruthVersion).toBe(3);
    expect(historical.closeout).toBeUndefined();
    expect(validateRunLedgerV2(historical)).toEqual([]);
  });

  it('creates a valid v4 Run only when an explicit closeout owner is supplied', () => {
    const run = createV4Run();
    expect(run.deliveryTruthVersion).toBe(4);
    expect(run.closeout).toEqual({
      contractVersion: 1,
      ownerRole: 'PRODUCT_MAIN_SESSION',
      terminalPolicy: RUN_CLOSEOUT_TERMINAL_POLICY,
      state: 'OPEN',
      closedAt: null,
      evidenceRef: null,
    });
    expect(validateRunLedgerV2(run)).toEqual([]);
  });

  it.each(['unknown', 'terra', 'product session', ''])('rejects ambiguous closeout owner %j', (owner) => {
    expect(() => createRunLedgerV2(
      '2026-09-05-invalid-closeout-owner',
      STARTED_AT,
      { closeoutOwner: owner },
    )).toThrow(/closeout-owner must be PRODUCT_MAIN_SESSION, GOVERNANCE_MAIN_SESSION, or OWNER/);
  });

  it('requires --closeout-owner on the operational init command', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-closeout-'));
    const output = path.join(directory, 'run.json');
    try {
      expect(() => runCli([
        'init',
        '--run-id', '2026-09-05-cli-closeout-owner',
        '--started-at', STARTED_AT,
        '--output', output,
      ])).toThrow(/--closeout-owner is required/);
      expect(fs.existsSync(output)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes a deterministic v4 closeout envelope through the operational init command', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-closeout-'));
    const output = path.join(directory, 'run.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      runCli([
        'init',
        '--run-id', '2026-09-05-cli-closeout-envelope',
        '--started-at', STARTED_AT,
        '--closeout-owner', 'GOVERNANCE_MAIN_SESSION',
        '--output', output,
      ]);
      const written = JSON.parse(fs.readFileSync(output, 'utf8'));
      expect(written.deliveryTruthVersion).toBe(4);
      expect(written.startedAt).toBe(STARTED_AT);
      expect(written.closeout.ownerRole).toBe('GOVERNANCE_MAIN_SESSION');
      expect(written.closeout.terminalPolicy).toBe(RUN_CLOSEOUT_TERMINAL_POLICY);
      expect(validateRunLedgerV2(written)).toEqual([]);
    } finally {
      log.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not let a non-final Run pretend that closeout is complete', () => {
    const run = createV4Run();
    run.closeout.state = 'CLOSED';
    run.closeout.closedAt = ENDED_AT;
    run.closeout.evidenceRef = 'github:issue#193';

    expect(validateRunLedgerV2(run)).toEqual(expect.arrayContaining([
      'non-final Run must keep closeout.state=OPEN',
      'non-final Run must keep closeout.closedAt=null',
      'non-final Run must keep closeout.evidenceRef=null',
    ]));
  });

  it('fails closed when a final v4 Run is missing its terminal envelope', () => {
    const run = createV4Run();
    run.status = 'COMPLETE';

    expect(validateRunLedgerV2(run)).toEqual(expect.arrayContaining([
      'final Run requires closeout.state=CLOSED',
      'final v4 Run requires endedAt',
      'final v4 Run requires a 40-character main.endSha',
      'final v4 Run requires inventory.openIssuesEnd as a non-negative integer',
      'final v4 Run requires inventory.openPrsEnd as a non-negative integer',
      'final v4 Run requires a usable closeout.evidenceRef',
    ]));
  });

  it('accepts a final v4 Run only after closeout time, end SHA, inventory, and evidence agree', () => {
    const run = closeRun(createV4Run());
    expect(validateRunLedgerV2(run)).toEqual([]);

    run.closeout.closedAt = '2026-09-05T02:00:01Z';
    expect(validateRunLedgerV2(run)).toContain('closeout.closedAt must equal endedAt');
  });

  it('rejects extra closeout fields instead of silently accepting a new dialect', () => {
    const run = createV4Run();
    run.closeout.note = 'some unreviewed meaning';
    expect(validateRunLedgerV2(run)).toContain(
      'deliveryTruthVersion=4 requires closeout with exactly contractVersion, ownerRole, terminalPolicy, state, closedAt, evidenceRef',
    );
  });
});
