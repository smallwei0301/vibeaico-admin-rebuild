import { describe, expect, it } from 'vitest';
import {
  confirmAutoReplyCheck,
  createLineSetupWizard,
  createRichMenuCheck,
  lineTestResultToCheck,
  lineUserError,
  mapLineVerifyChecks,
  mergeLineSetupChecks,
} from '@/lib/line-setup-wizard';

describe('GUIDE LINE 開通精靈 view model（19 分冊 §6）', () => {
  it('初始化時把缺少 backend 能力的測試訊息與 outbox 明確標成尚未提供', () => {
    const state = createLineSetupWizard();

    expect(state.steps.map((step) => [step.key, step.status])).toEqual([
      ['CREDENTIALS', 'PENDING'],
      ['WEBHOOK_URL', 'PENDING'],
      ['WEBHOOK_ENABLED', 'PENDING'],
      ['AUTO_REPLY', 'ACTION_REQUIRED'],
      ['RICH_MENU', 'PENDING'],
      ['QUOTA', 'PENDING'],
      ['TEST_MESSAGE', 'BLOCKED'],
      ['OUTBOX', 'BLOCKED'],
    ]);
    expect(state.ready).toBe(false);
    expect(state.steps.find((step) => step.key === 'TEST_MESSAGE')?.description)
      .toContain('沒有 tenant-scoped 實際測試訊息 endpoint');
    expect(state.steps.find((step) => step.key === 'OUTBOX')?.description)
      .toContain('#40');
  });

  it('把 Token、Webhook、額度與圖文選單錯誤轉成獨立白話處理方式', () => {
    const checks = mapLineVerifyChecks([
      { key: 'TOKEN', pass: false, message: '401 Invalid access token' },
      { key: 'WEBHOOK', pass: false, message: 'endpoint mismatch; active=false' },
      { key: 'RICH_MENU', pass: false, message: '尚未設定預設 Rich Menu' },
      { key: 'QUOTA', pass: false, message: 'quota request timeout' },
    ]);
    const state = mergeLineSetupChecks(createLineSetupWizard(), checks);

    expect(state.steps.find((step) => step.key === 'CREDENTIALS')).toMatchObject({
      status: 'FAILED',
      title: 'LINE 帳號還沒連線',
      description: '這間店的 LINE 憑證無法使用，請重新複製 Channel Access Token。',
      detail: '401 Invalid access token',
    });
    expect(state.steps.find((step) => step.key === 'WEBHOOK_URL')).toMatchObject({
      status: 'FAILED',
      description: 'LINE 還沒有把訊息送到這間店，請貼上這間店的專屬網址。',
    });
    expect(state.steps.find((step) => step.key === 'WEBHOOK_ENABLED')).toMatchObject({
      status: 'FAILED',
      description: '請到 LINE 後台開啟 Use webhook，讓訊息能送回 Midao。',
    });
    expect(state.steps.find((step) => step.key === 'RICH_MENU')?.description)
      .toContain('目前沒有');
    expect(state.steps.find((step) => step.key === 'QUOTA')?.description)
      .toContain('暫時查不到');
  });

  it('verify 的成功結果與手動確認可以合併，且 provider 200 不宣稱顧客已讀', () => {
    const state = mergeLineSetupChecks(createLineSetupWizard(), [
      ...mapLineVerifyChecks([
        { key: 'TOKEN', pass: true, message: 'ok' },
        { key: 'WEBHOOK', pass: true, message: 'ok' },
        { key: 'RICH_MENU', pass: true, message: 'ok' },
      ]),
      confirmAutoReplyCheck(),
      lineTestResultToCheck({ ok: true, message: 'HTTP 200' }),
      createRichMenuCheck({ richMenuId: 'rm_1' }),
    ]);

    expect(state.completedCount).toBe(5);
    expect(state.steps.find((step) => step.key === 'TEST_MESSAGE')?.status).toBe('BLOCKED');
    expect(state.steps.find((step) => step.key === 'CREDENTIALS')).toMatchObject({
      evidence: 'PROVIDER_ACCEPTED',
      description: '可以讀取這個 LINE 官方帳號的基本資料。',
    });
    expect(state.steps.find((step) => step.key === 'RICH_MENU')?.description)
      .toContain('不保證每位顧客已立即看到');
    expect(state.steps.find((step) => step.key === 'AUTO_REPLY')).toMatchObject({
      status: 'PASSED',
      evidence: 'USER_CONFIRMED',
    });
  });

  it('單一步驟重試保留其他成功結果，新的失敗會清掉舊證據', () => {
    const accepted = mergeLineSetupChecks(createLineSetupWizard(), [
      { key: 'CREDENTIALS', status: 'PASSED', evidence: 'PROVIDER_ACCEPTED' },
      {
        key: 'QUOTA',
        status: 'PASSED',
        detail: 'quota-1',
        evidence: 'PROVIDER_STATE',
        quota: { limit: 100, used: 40 },
      },
    ]);
    const failed = mergeLineSetupChecks(accepted, [
      { key: 'QUOTA', status: 'FAILED', detail: 'timeout', summary: '請稍後重試' },
    ]);

    expect(failed.steps.find((step) => step.key === 'CREDENTIALS')?.status).toBe('PASSED');
    expect(failed.steps.find((step) => step.key === 'QUOTA')).toMatchObject({
      status: 'FAILED',
      detail: 'timeout',
      evidence: undefined,
      quota: undefined,
      description: '請稍後重試',
    });
  });

  it('額度剩餘量最低為 0，不顯示負數', () => {
    const state = mergeLineSetupChecks(createLineSetupWizard(), [
      { key: 'QUOTA', status: 'PASSED', quota: { limit: 100, used: 130 } },
    ]);

    expect(state.steps.find((step) => step.key === 'QUOTA')?.description)
      .toBe('本月還可發送 0 則訊息');
  });

  it('不會因 AUTO_REPLY API 的固定 false 覆蓋店家已完成的人工確認', () => {
    const confirmed = mergeLineSetupChecks(createLineSetupWizard(), [confirmAutoReplyCheck()]);
    const afterVerify = mergeLineSetupChecks(confirmed, [
      ...mapLineVerifyChecks([{ key: 'AUTO_REPLY', pass: false, message: '無公開 API 可查' }]),
    ]);

    expect(afterVerify.steps.find((step) => step.key === 'AUTO_REPLY')).toMatchObject({
      status: 'PASSED',
      evidence: 'USER_CONFIRMED',
    });
  });

  it('endpoint-level 與網路錯誤不會被誤標成額度錯誤', () => {
    expect(lineUserError('GENERAL', 'verify endpoint returned 500'))
      .toBe('這項檢查沒有通過，請查看下一步說明後重試。');
    expect(lineUserError('GENERAL', 'request timeout'))
      .toBe('暫時連不上 LINE，請稍後再試；其他設定會保留。');
    expect(lineUserError('QUOTA', 'request timeout'))
      .toBe('LINE 暫時查不到本月可用訊息量，請稍後重試。');
  });
});
