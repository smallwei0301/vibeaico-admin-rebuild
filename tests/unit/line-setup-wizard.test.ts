import { describe, expect, it } from 'vitest';
import {
  createLineSetupWizard,
  mergeLineSetupChecks,
  type LineSetupCheck,
} from '@/lib/line-setup-wizard';

describe('LINE 開通精靈 view model（19 分冊 §6）', () => {
  it('Token、Webhook、未啟用、額度與圖文選單錯誤各自顯示，不互相蓋掉', () => {
    const checks: LineSetupCheck[] = [
      { key: 'CREDENTIALS', status: 'FAILED', detail: '401' },
      { key: 'WEBHOOK_URL', status: 'FAILED', detail: '網址不符' },
      { key: 'WEBHOOK_ENABLED', status: 'FAILED' },
      { key: 'QUOTA', status: 'FAILED', detail: 'timeout' },
      { key: 'RICH_MENU', status: 'FAILED' },
    ];

    const state = mergeLineSetupChecks(createLineSetupWizard(), checks);

    expect(state.steps.map((step) => [step.key, step.status, step.title])).toEqual([
      ['CREDENTIALS', 'FAILED', 'LINE 帳號還沒連線'],
      ['WEBHOOK_URL', 'FAILED', 'LINE 還沒把訊息送到這間店'],
      ['WEBHOOK_ENABLED', 'FAILED', 'LINE 的訊息回傳功能尚未開啟'],
      ['AUTO_REPLY', 'PENDING', '確認 LINE 不會搶先自動回覆'],
      ['RICH_MENU', 'FAILED', '圖文選單尚未發布'],
      ['QUOTA', 'FAILED', '暫時查不到本月可用訊息量'],
      ['TEST_MESSAGE', 'PENDING', '尚未發送測試訊息'],
      ['OUTBOX', 'PENDING', '尚未留下測試派送紀錄'],
    ]);
    expect(state.steps[0].detail).toBe('401');
    expect(state.steps[1].detail).toBe('網址不符');
  });

  it('重試只更新本次檢查，保留其他已完成設定', () => {
    const beforeRetry = mergeLineSetupChecks(createLineSetupWizard(), [
      { key: 'CREDENTIALS', status: 'PASSED' },
      { key: 'WEBHOOK_URL', status: 'FAILED' },
      { key: 'RICH_MENU', status: 'PASSED' },
    ]);

    const afterRetry = mergeLineSetupChecks(beforeRetry, [
      { key: 'WEBHOOK_URL', status: 'PASSED' },
    ]);

    expect(afterRetry.steps.find((step) => step.key === 'CREDENTIALS')?.status).toBe('PASSED');
    expect(afterRetry.steps.find((step) => step.key === 'WEBHOOK_URL')?.status).toBe('PASSED');
    expect(afterRetry.steps.find((step) => step.key === 'RICH_MENU')?.status).toBe('PASSED');
  });

  it('同一步驟重試時清掉已過時的證據與詳細資料', () => {
    const accepted = mergeLineSetupChecks(createLineSetupWizard(), [
      {
        key: 'TEST_MESSAGE',
        status: 'PASSED',
        detail: 'request-1',
        evidence: 'PROVIDER_ACCEPTED',
      },
    ]);

    const failed = mergeLineSetupChecks(accepted, [
      { key: 'TEST_MESSAGE', status: 'FAILED' },
    ]);

    expect(failed.steps.find((step) => step.key === 'TEST_MESSAGE')).toMatchObject({
      status: 'FAILED',
      detail: undefined,
      evidence: undefined,
      quota: undefined,
    });
  });

  it('provider 接受測試訊息只表示已交給 LINE，不宣稱顧客已讀', () => {
    const state = mergeLineSetupChecks(createLineSetupWizard(), [
      { key: 'TEST_MESSAGE', status: 'PASSED', evidence: 'PROVIDER_ACCEPTED' },
    ]);
    const step = state.steps.find((item) => item.key === 'TEST_MESSAGE');

    expect(step).toMatchObject({
      status: 'PASSED',
      title: 'LINE 平台已接受測試訊息',
      evidence: 'PROVIDER_ACCEPTED',
    });
    expect(step?.description).toContain('不代表顧客已讀');
    expect(step?.description).not.toContain('顧客已收到');
  });

  it('額度剩餘量最低為 0，不顯示負數', () => {
    const state = mergeLineSetupChecks(createLineSetupWizard(), [
      { key: 'QUOTA', status: 'PASSED', quota: { limit: 100, used: 130 } },
    ]);
    const step = state.steps.find((item) => item.key === 'QUOTA');

    expect(step?.description).toBe('本月還可發送 0 則訊息');
  });
});
