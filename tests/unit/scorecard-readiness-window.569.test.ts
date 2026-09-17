import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { analyzeScorecardReadiness } from '../../scripts/agents/scorecard-readiness.mjs';

// Synthetic fixtures only. None of these timestamps attest to a real Agent dispatch.
function fixture(startedAt = '2026-09-17T03:54:26.487Z'): any {
  const run: any = createRunLedgerV2('2026-09-17-window-test', startedAt, { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
  run.inventory.mainTerraPeak = 1;
  run.inventory.activeCandidatePeak = 1;
  run.delivery.issuesStarted = 1;
  run.modelUsage.tasks = [{ id: 'fixture-task', requestedModel: 'terra', actualModel: 'terra', actualModelId: 'test-terra', role: 'test only', count: 1, contextClass: 'compact', accepted: false, inputTokens: null, outputTokens: null, cachedTokens: null }];
  run.wipLifecycle.events = [{ id: 'fixture-enter', at: startedAt, kind: 'BUILD_ENTER', pr: 562, issue: 17, head: 'a'.repeat(40), workstream: 'PRODUCT_MAINLINE', reason: 'synthetic fixture, not real dispatch evidence' }];
  return run;
}

describe('Live Scorecard Run time boundary (#569 / #564)', () => {
  it.each(['2026-09-17T03:15:00Z', '2026-09-17T03:24:00Z', '2026-09-17T03:54:26.486Z'])(
    'rejects a sorted and count-consistent event before Run start: %s', at => {
      const run = fixture();
      run.wipLifecycle.events[0].at = at;
      const result = analyzeScorecardReadiness(run);
      expect(result.validLedger).toBe(true);
      expect(result.consistencyWarnings).toEqual([]);
      expect(result.liveCaptureStatus).toBe('NEEDS_CAPTURE');
      expect(result.rawCaptureGaps).toContain('wipLifecycle.events[0].at precedes Run startedAt; do not backdate the Run or invent dispatch evidence');
    },
  );

  it('allows an event exactly at the start boundary', () => {
    expect(analyzeScorecardReadiness(fixture()).liveCaptureStatus).toBe('LIVE_CAPTURE_READY');
  });

  it('allows an in-window event and keeps an active Run without an end', () => {
    const run = fixture();
    run.wipLifecycle.events[0].at = '2026-09-17T03:55:00Z';
    expect(analyzeScorecardReadiness(run).readyForContinuedCapture).toBe(true);
  });

  it('rejects an event after the declared end even with otherwise consistent counters', () => {
    const run = fixture();
    run.endedAt = '2026-09-17T04:00:00Z';
    run.wipLifecycle.events[0].at = '2026-09-17T04:00:00.001Z';
    const result = analyzeScorecardReadiness(run);
    expect(result.validLedger).toBe(true);
    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.rawCaptureGaps).toContain('wipLifecycle.events[0].at exceeds Run endedAt; keep outside-window observations separate');
  });

  it('allows an event exactly at the end boundary', () => {
    const run = fixture();
    run.endedAt = '2026-09-17T04:00:00Z';
    run.wipLifecycle.events[0].at = run.endedAt;
    expect(analyzeScorecardReadiness(run).liveCaptureStatus).toBe('LIVE_CAPTURE_READY');
  });

  it('checks every event, not just the first one', () => {
    const run = fixture();
    run.endedAt = '2026-09-17T04:00:00Z';
    run.wipLifecycle.events.push({ ...run.wipLifecycle.events[0], id: 'fixture-exit', kind: 'BUILD_EXIT', at: '2026-09-17T04:01:00Z' });
    const result = analyzeScorecardReadiness(run);
    expect(result.validLedger).toBe(true);
    expect(result.rawCaptureGaps.some((gap: string) => gap.includes('events[1]') && gap.includes('endedAt'))).toBe(true);
  });

  it('does not mutate raw events, times or counters to obtain a green result', () => {
    const run = fixture();
    run.wipLifecycle.events[0].at = '2026-09-17T03:15:00Z';
    const bytes = JSON.stringify(run);
    analyzeScorecardReadiness(run);
    expect(JSON.stringify(run)).toBe(bytes);
  });

  it('leaves pre-cutoff historical replay semantics unchanged', () => {
    const run = fixture('2026-09-14T03:54:26.487Z');
    run.wipLifecycle.events[0].at = '2026-09-14T03:15:00Z';
    const result = analyzeScorecardReadiness(run);
    expect(result.scoreProfileTarget).toBe('LEGACY_V2');
    expect(result.rawCaptureGaps).toEqual([]);
    expect(result.readyForContinuedCapture).toBe(true);
  });

  it('retains malformed timestamp rejection', () => {
    const run = fixture();
    run.wipLifecycle.events[0].at = 'not-a-date';
    expect(analyzeScorecardReadiness(run).validLedger).toBe(false);
    expect(analyzeScorecardReadiness(run).liveCaptureStatus).toBe('NEEDS_CAPTURE');
  });

  it('the actual strict-live CLI exits nonzero for the #564-shaped counterexample', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-window-'));
    try {
      const filename = path.join(dir, 'run.json');
      const run = fixture();
      run.wipLifecycle.events[0].at = '2026-09-17T03:15:00Z';
      fs.writeFileSync(filename, JSON.stringify(run));
      const rejected = spawnSync(process.execPath, ['scripts/agents/scorecard-readiness.mjs', filename, '--strict-live'], { encoding: 'utf8' });
      expect(rejected.error).toBeUndefined();
      expect(rejected.stderr).toBe('');
      expect(rejected.status).toBe(2);
      expect(rejected.stdout).toContain('NEEDS_CAPTURE');
      fs.writeFileSync(filename, JSON.stringify(fixture()));
      const accepted = spawnSync(process.execPath, ['scripts/agents/scorecard-readiness.mjs', filename, '--strict-live'], { encoding: 'utf8' });
      expect(accepted.status).toBe(0);
      expect(accepted.stdout).toContain('LIVE_CAPTURE_READY');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
