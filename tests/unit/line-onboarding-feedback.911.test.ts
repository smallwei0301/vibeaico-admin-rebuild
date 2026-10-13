// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lineSettingsPage } from '@/i18n/zh-TW/pages/line-settings';
import { lineSetupWizardPage } from '@/i18n/zh-TW/line-setup-wizard';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('#911 LINE 開通精靈回饋', () => {
  it('saveCredentials 檢查 Secret 與 Token', () => {
    const src = read('src/app/tenant/line-settings/onboarding/page.tsx');
    const body = src.slice(src.indexOf('const saveCredentials'), src.indexOf('const retryVerify'));
    expect(body).toMatch(/secretEditing && !!secretInput\.trim\(\)/);
    expect(body).toMatch(/tokenEditing && !!tokenInput\.trim\(\)/);
    expect(body).toContain('settings?.line.channelSecret');
    expect(body).toContain('settings?.line.channelAccessToken');
    expect(body.indexOf('secretRequired')).toBeLessThan(body.indexOf('saveLineSettings('));
  });

  it.each([
    'src/app/api/settings/line/verify/route.ts',
    'src/app/api/settings/line/test/route.ts',
  ])('%s 不把 LINE 原文放進回應訊息', (file) => {
    const src = read(file);
    for (const k of ['message', 'error', 'reason', 'detail']) {
      const re = new RegExp(`body\\?\\.${k}\\b`, 'g');
      const hits = (src.match(re) ?? []).length;
      const inWarn = [...src.matchAll(/console\.warn\([^;]*\);/gs)]
        .map((m) => (m[0].match(re) ?? []).length)
        .reduce((a, b) => a + b, 0);
      expect(hits, `${file} body?.${k}`).toBe(inWarn);
    }
  });

  it('FAQ 不宣稱儲存會自動設定，且引用的按鈕名稱存在', () => {
    const text = lineSettingsPage.help.faq.map((f) => f.a).join('\n') + lineSettingsPage.tutorial.verifyWebhook.body;
    expect(text).not.toContain('儲存後系統會自動');
    expect(text).not.toContain('儲存設定後，系統會自動');
    expect(text).not.toContain('觸發自動連線');
    expect(text).toContain(lineSettingsPage.connection.verify);
    expect(text).toContain(lineSettingsPage.verifyReport.webhookSync.action);
    expect(text).toContain(lineSetupWizardPage.botWebhook.fixWebhook);
  });
  it('WEBHOOK_TEST 失敗訊息依 WEBHOOK 檢查結果分流', () => {
    const src = read('src/app/api/settings/line/verify/route.ts');
    const seg = src.slice(src.indexOf("// WEBHOOK_TEST"), src.indexOf("// AUTO_REPLY"));
    expect(seg).toMatch(/test\.ok\s*\?\s*webhookPassed/);
    expect(seg).toContain('Channel Secret 不正確');
    expect(seg).toContain('一鍵幫我設定並開啟 Webhook');
    expect(seg).toContain('Webhook 測試請求失敗');
    expect(seg.indexOf('Channel Secret 不正確')).toBeLessThan(seg.indexOf('一鍵幫我設定並開啟 Webhook'));
  });

  it('FAQ／verifyWebhook 不無條件指向自動修正網址，網址正確時提示檢查 Channel Secret', () => {
    const items = [lineSettingsPage.tutorial.verifyWebhook.body, lineSettingsPage.help.faq.map((f) => f.a).find((a) => a.includes('收到 200')) ?? ''];
    for (const text of items) {
      expect(text).toContain('Webhook 網址」項目失敗');
      expect(text).toContain('Channel Secret');
    }
  });
});
