// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldEditCredentialByDefault,
  shouldOfferWebhookFix,
  type VerifyCheck,
} from '@/lib/line-setup-wizard';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = read('src/app/tenant/line-settings/onboarding/page.tsx');

const chk = (key: string, status: 'PASS' | 'FAIL' | 'INFO'): VerifyCheck => ({
  key, status, pass: status === 'PASS', message: 'x',
});

describe('#926 新店家憑證欄位預設可輸入', () => {
  it('遮罩值為空 → 預設進入編輯；有值 → 維持遮罩', () => {
    expect(shouldEditCredentialByDefault('')).toBe(true);
    expect(shouldEditCredentialByDefault(undefined)).toBe(true);
    expect(shouldEditCredentialByDefault(null)).toBe(true);
    expect(shouldEditCredentialByDefault('****abcd')).toBe(false);
  });

  it('編輯狀態只在載入 settings 時決定，且初始值不再硬編碼為已設定', () => {
    const load = page.slice(page.indexOf('const loadSettings'), page.indexOf('React.useEffect(() => {\n    mounted.current = true'));
    expect(load).toContain('setSecretEditing(shouldEditCredentialByDefault(s.line.channelSecret))');
    expect(load).toContain('setTokenEditing(shouldEditCredentialByDefault(s.line.channelAccessToken))');
    // 不得有第二個 effect 依 settings 反覆覆寫編輯狀態
    expect(page.match(/setSecretEditing\(shouldEditCredentialByDefault/g)).toHaveLength(1);
  });

  it('未設定時隱藏「取消重新輸入」，已設定時才顯示', () => {
    expect(page).toContain('settings.line.channelSecret ? (');
    expect(page).toContain('settings.line.channelAccessToken ? (');
  });

  it('存檔判斷仍沿用 #911：新輸入送新值、未輸入時提示缺漏', () => {
    const body = page.slice(page.indexOf('const saveCredentials'), page.indexOf('const retryVerify'));
    expect(body).toMatch(/secretEditing && !!secretInput\.trim\(\)/);
    expect(body).toMatch(/channelSecret: secretEditing \? secretInput\.trim\(\) : ''/);
    expect(body).toMatch(/channelAccessToken: tokenEditing \? tokenInput\.trim\(\) : ''/);
    expect(body.indexOf('secretAndTokenRequired')).toBeLessThan(body.indexOf('saveLineSettings('));
  });
});

describe('#926 步驟四 Webhook 測試失敗可一鍵修正', () => {
  it('WEBHOOK 未開／網址不符（FAIL）→ 顯示', () => {
    expect(shouldOfferWebhookFix([chk('WEBHOOK', 'FAIL'), chk('WEBHOOK_TEST', 'FAIL')])).toBe(true);
  });
  it('WEBHOOK 結果缺漏但 WEBHOOK_TEST FAIL → 顯示', () => {
    expect(shouldOfferWebhookFix([chk('WEBHOOK_TEST', 'FAIL')])).toBe(true);
  });
  it('WEBHOOK 已通過但測試失敗（網站問題）→ 不顯示', () => {
    expect(shouldOfferWebhookFix([chk('WEBHOOK', 'PASS'), chk('WEBHOOK_TEST', 'FAIL')])).toBe(false);
  });
  it('全部通過或尚未檢查 → 不顯示', () => {
    expect(shouldOfferWebhookFix([chk('WEBHOOK', 'PASS'), chk('WEBHOOK_TEST', 'PASS')])).toBe(false);
    expect(shouldOfferWebhookFix(null)).toBe(false);
  });

  it('步驟四渲染同一個 fixWebhook 按鈕', () => {
    const step4 = page.slice(page.indexOf("step === 'WEBHOOK_TEST'"), page.indexOf("step === 'AUTO_REPLY_CONFIRM'"));
    expect(step4).toContain('shouldOfferWebhookFix(checks)');
    expect(step4).toContain('void fixWebhook()');
    expect(step4).toContain('t.botWebhook.fixWebhook');
  });
});
