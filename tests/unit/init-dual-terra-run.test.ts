import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildDualTerraRun,
  writeDualTerraRun,
} from '../../scripts/agents/init-dual-terra-run.mjs';
import { validateRun } from '../../scripts/agents/run-ledger.mjs';

describe('dual Terra run initializer', () => {
  it('creates a schema-valid IN_PROGRESS ledger without guessing unavailable metrics', () => {
    const run = buildDualTerraRun({
      runId: '2026-09-02-dual-terra-r01',
      mainSha: 'main-sha',
      openIssues: 40,
      openPrs: 8,
      startedAt: '2026-09-02T00:00:00.000Z',
    });

    expect(validateRun(run)).toEqual({ valid: true, errors: [] });
    expect(run).toMatchObject({
      status: 'IN_PROGRESS',
      main: { startSha: 'main-sha', endSha: null },
      sources: { openIssueStart: 40, openPrStart: 8 },
      inventory: {
        dualTerraPilot: true,
        terraTarget: 2,
        mainTerraPeak: 0,
        reserveTerraPeak: 0,
        slot1ActiveMinutes: null,
        slot2ActiveMinutes: null,
        localIsolatedJobs: null,
        remoteCanonicalWaitMinutes: null,
        fallbackToSingleTerra: false,
      },
    });
  });

  it('writes once and refuses to overwrite audit history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dual-terra-run-'));
    const run = buildDualTerraRun({
      runId: '2026-09-02-dual-terra-r02',
      mainSha: 'main-sha',
      startedAt: '2026-09-02T00:00:00.000Z',
    });
    try {
      const output = writeDualTerraRun({ run, outputDir: directory });
      expect(JSON.parse(readFileSync(output, 'utf8')).runId).toBe(run.runId);
      expect(() => writeDualTerraRun({ run, outputDir: directory })).toThrow('refusing to overwrite');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires a current main SHA instead of inventing one', () => {
    expect(() => buildDualTerraRun({
      runId: '2026-09-02-dual-terra-r03',
      mainSha: '',
    })).toThrow('mainSha is required');
  });
});
