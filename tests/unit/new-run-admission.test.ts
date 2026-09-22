/*
 * 新 Run 不得在既有 Run 還開著的時候無聲長出來。
 *
 * 2026-09-22 複盤查到 `2026-09-21-product-delivery-r03` 仍是 IN_PROGRESS／OPEN，
 * 同一條交付線就又宣告了 `2026-09-22-product-delivery-r01`。兩份帳本各記一半，
 * 兩份都不是那一段時間的真相，而沒有任何一關在問「舊的那份呢」。
 *
 * 這個 guard 只擋「新宣告的 RUN_ID」：接續既有 Run 不受影響，非 Product PR 不受影響。
 * 要的是看一眼並寫出理由，不是停工。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import {
  readKnownProductRuns, readOpenProductRuns, validateNewRunAdmission,
} from '../../scripts/agents/scorecard-required-gate.mjs';

const NEW_RUN = '2026-09-22-product-delivery-r09';
const OPEN_RUN = '2026-09-21-product-delivery-r03';

function body(runId: string, extra = ''): string {
  return `<!-- pr-lifecycle\nissue: 670\nstate: ACTIVE\nsupersedes:\n-->
WORKSTREAM: PRODUCT_MAINLINE
RUN_ID: ${runId}
SCORECARD_PATH: docs/metrics/agent-runs/${runId}.json
${extra}`;
}

const rejection = (errors: string[]) => errors.filter((error) => error.startsWith('NEW_RUN_ADMISSION_REJECTED'));

describe('新 Run 的 admission：既有 Run 還開著就要交代', () => {
  it('沒有其他開著的 Run 時放行', () => {
    assert.deepEqual(validateNewRunAdmission({ body: body(NEW_RUN), openRuns: [], knownRuns: [] }), []);
  });

  it('接續既有 Run（RUN_ID 已在 main 上）不受影響', () => {
    assert.deepEqual(validateNewRunAdmission({
      body: body(OPEN_RUN), openRuns: [OPEN_RUN, '2026-09-17-product-delivery-r01'], knownRuns: [OPEN_RUN],
    }), []);
  });

  it('宣告新 RUN_ID 而既有 Run 還開著、又沒交代時擋下', () => {
    const errors = validateNewRunAdmission({ body: body(NEW_RUN), openRuns: [OPEN_RUN], knownRuns: [] });
    assert.equal(rejection(errors).length, 1);
    assert.match(errors[0], new RegExp(`new RUN_ID ${NEW_RUN} while 1 Run\\(s\\) remain open`));
    assert.match(errors[0], new RegExp(OPEN_RUN));
  });

  it('交代必須逐一點名每個開著的 Run，漏掉一個仍然擋下', () => {
    const errors = validateNewRunAdmission({
      body: body(NEW_RUN, `CONCURRENT_RUN_JUSTIFICATION: ${OPEN_RUN} 由另一個 Session 持有，本輪不接手`),
      openRuns: [OPEN_RUN, '2026-09-17-product-delivery-r01'],
      knownRuns: [],
    });
    assert.equal(rejection(errors).length, 1);
    assert.match(errors[0], /missing: 2026-09-17-product-delivery-r01/);
  });

  it('逐一點名且理由可用時放行', () => {
    assert.deepEqual(validateNewRunAdmission({
      body: body(NEW_RUN, `CONCURRENT_RUN_JUSTIFICATION: ${OPEN_RUN} 與 2026-09-17-product-delivery-r01 由其他 Session 持有，本輪不接手也不代為收尾`),
      openRuns: [OPEN_RUN, '2026-09-17-product-delivery-r01'],
      knownRuns: [],
    }), []);
  });

  it('none／TBD／樣板註解不算交代', () => {
    for (const value of ['none', 'TBD', 'unknown', '-', '', '<!-- 填這裡 -->']) {
      const errors = validateNewRunAdmission({
        body: body(NEW_RUN, `CONCURRENT_RUN_JUSTIFICATION: ${value} ${OPEN_RUN}`),
        openRuns: [OPEN_RUN],
        knownRuns: [],
      });
      assert.equal(rejection(errors).length, 1, `「${value}」不應被當成理由`);
    }
  });

  it('非 PRODUCT_MAINLINE 的 PR 不受這一關影響', () => {
    const governanceBody = `<!-- pr-lifecycle\nissue: 670\nstate: ACTIVE\nsupersedes:\n-->
WORKSTREAM: MODEL_GOVERNANCE
`;
    assert.deepEqual(validateNewRunAdmission({
      body: governanceBody, openRuns: [OPEN_RUN], knownRuns: [],
    }), []);
  });
});

describe('從 canonical checkout 讀 Run 狀態', () => {
  it('只把 schemaVersion 2 且 status 未結、closeout OPEN 的當成開著', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-admission-'));
    try {
      mkdirSync(path.join(root, 'docs/metrics/agent-runs'), { recursive: true });
      const write = (runId: string, mutate: (run: any) => void) => {
        const run: any = createRunLedgerV2(runId, '2026-09-22T00:00:00Z', { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
        mutate(run);
        writeFileSync(path.join(root, `docs/metrics/agent-runs/${runId}.json`), JSON.stringify(run));
      };
      write('2026-09-22-open-run', () => {});
      write('2026-09-22-closed-run', (run) => { run.status = 'COMPLETE'; run.closeout.state = 'CLOSED'; });
      write('2026-09-22-legacy-v1', (run) => { run.schemaVersion = 1; });
      writeFileSync(path.join(root, 'docs/metrics/agent-runs/broken.json'), '{ not json');

      assert.deepEqual(readOpenProductRuns(root), ['2026-09-22-open-run']);
      assert.deepEqual(readKnownProductRuns(root).sort(),
        ['2026-09-22-closed-run', '2026-09-22-legacy-v1', '2026-09-22-open-run', 'broken']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('沒有 agent-runs 目錄時回空陣列，不丟例外', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-admission-empty-'));
    try {
      assert.deepEqual(readOpenProductRuns(root), []);
      assert.deepEqual(readKnownProductRuns(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
