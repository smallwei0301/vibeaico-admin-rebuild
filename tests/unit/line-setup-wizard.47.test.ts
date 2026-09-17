/**
 * tests/unit/line-setup-wizard.47.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/lib/line-setup-wizard.ts`（Issue #47 開通精靈的純邏輯層）：
 *
 *   1. `deriveStartingStep` 必須依「真實 verify 結果」重建進度，而不是憑空猜測
 *      ——這是任務要求的「重新整理要能反映真實 provider 狀態」的核心保證。
 *   2. `canAdvanceFromStep` 必須擋住「檢查沒過還能跳下一步」。
 *   3. `stepStatus` / `allVerifiableChecksPassed` 必須把 AUTO_REPLY 的 INFO
 *      跟六項可查證檢查的 PASS/FAIL 分開算，永遠不能把 INFO 算成失敗。
 */
import { describe, it, expect } from 'vitest';
import {
  allVerifiableChecksPassed, canAdvanceFromStep, credentialsConfigured,
  deriveStartingStep, stepStatus, type VerifyCheck,
} from '@/lib/line-setup-wizard';

function check(key: string, status: 'PASS' | 'FAIL' | 'INFO', message = ''): VerifyCheck {
  return { key, status, pass: status === 'PASS', message };
}

const ALL_PASS: VerifyCheck[] = [
  check('CREDENTIALS', 'PASS'),
  check('TOKEN', 'PASS'),
  check('ID_SECRET_PAIR', 'PASS'),
  check('BOT_MODE', 'PASS'),
  check('WEBHOOK', 'PASS'),
  check('WEBHOOK_TEST', 'PASS'),
  check('AUTO_REPLY', 'INFO'),
];

describe('credentialsConfigured', () => {
  it('三項都要有才算已設定', () => {
    expect(credentialsConfigured({ channelId: true, channelSecret: true, channelAccessToken: true })).toBe(true);
    expect(credentialsConfigured({ channelId: true, channelSecret: false, channelAccessToken: true })).toBe(false);
  });
});

describe('deriveStartingStep — 用真實 verify 結果重建進度', () => {
  it('憑證沒填齊 → 一律回到步驟一，即使帶了 checks', () => {
    expect(deriveStartingStep(
      { channelId: false, channelSecret: true, channelAccessToken: true },
      ALL_PASS,
    )).toBe('CREDENTIALS_INPUT');
  });

  it('憑證填齊但還沒 verify 過（checks === null）→ 停在步驟一等 verify', () => {
    expect(deriveStartingStep(
      { channelId: true, channelSecret: true, channelAccessToken: true },
      null,
    )).toBe('CREDENTIALS_INPUT');
  });

  it('CREDENTIALS/TOKEN/ID_SECRET_PAIR 任一 FAIL → 停在 CONNECTION', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'TOKEN' ? check('TOKEN', 'FAIL', 'Token 失效') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('CONNECTION');
  });

  it('BOT_MODE 或 WEBHOOK FAIL → 停在 BOT_MODE_WEBHOOK', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK' ? check('WEBHOOK', 'FAIL', '未開啟') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('BOT_MODE_WEBHOOK');
  });

  it('WEBHOOK_TEST FAIL → 停在 WEBHOOK_TEST', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK_TEST' ? check('WEBHOOK_TEST', 'FAIL', '測試失敗') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('WEBHOOK_TEST');
  });

  it('六項全過 → 停在 AUTO_REPLY_CONFIRM（每次重開都值得再提醒，因為系統查不到真實狀態）', () => {
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, ALL_PASS))
      .toBe('AUTO_REPLY_CONFIRM');
  });
});

describe('canAdvanceFromStep — 擋住「檢查沒過還能跳下一步」', () => {
  it('CONNECTION 沒全過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'CREDENTIALS' ? check('CREDENTIALS', 'FAIL') : c));
    expect(canAdvanceFromStep('CONNECTION', checks)).toBe(false);
    expect(canAdvanceFromStep('CONNECTION', ALL_PASS)).toBe(true);
  });

  it('BOT_MODE_WEBHOOK 沒全過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'BOT_MODE' ? check('BOT_MODE', 'FAIL') : c));
    expect(canAdvanceFromStep('BOT_MODE_WEBHOOK', checks)).toBe(false);
  });

  it('WEBHOOK_TEST 沒過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK_TEST' ? check('WEBHOOK_TEST', 'FAIL') : c));
    expect(canAdvanceFromStep('WEBHOOK_TEST', checks)).toBe(false);
  });

  it('AUTO_REPLY_CONFIRM／CAPABILITIES／DONE 一律不擋路（人工確認與能力摘要不是硬性關卡）', () => {
    expect(canAdvanceFromStep('AUTO_REPLY_CONFIRM', null)).toBe(true);
    expect(canAdvanceFromStep('CAPABILITIES', null)).toBe(true);
    expect(canAdvanceFromStep('DONE', null)).toBe(true);
  });
});

describe('stepStatus / allVerifiableChecksPassed — INFO 永不算失敗', () => {
  it('AUTO_REPLY_CONFIRM 一律回報 INFO，不是 PASS 也不是 FAIL', () => {
    expect(stepStatus('AUTO_REPLY_CONFIRM', ALL_PASS)).toBe('INFO');
  });

  it('allVerifiableChecksPassed 只看六項可查證檢查，AUTO_REPLY 的 INFO 不影響結果', () => {
    expect(allVerifiableChecksPassed(ALL_PASS)).toBe(true);
    const withFail = ALL_PASS.map((c) => (c.key === 'WEBHOOK' ? check('WEBHOOK', 'FAIL') : c));
    expect(allVerifiableChecksPassed(withFail)).toBe(false);
  });

  it('checks 為 null 時一律回報尚未檢查／未通過', () => {
    expect(stepStatus('CONNECTION', null)).toBe('NOT_CHECKED');
    expect(allVerifiableChecksPassed(null)).toBe(false);
  });
});
