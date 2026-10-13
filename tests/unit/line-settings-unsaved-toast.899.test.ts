import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lineSettingsPage as t } from '@/i18n/zh-TW/pages/line-settings';

const page = readFileSync('src/app/tenant/line-settings/page.tsx', 'utf8');

describe('#899 LINE 設定切換 toast 須提示尚未儲存', () => {
  const toasts = [
    t.flexMenu.enabledToast,
    t.flexMenu.disabledToast,
    t.flexMenu.fallbackHintToast,
    t.flexMenu.fallbackSilentToast,
    t.flexMenu.campaignKeywordOnToast,
    t.flexMenu.campaignKeywordOffToast,
  ];

  it('每則切換 toast 都說明尚未儲存並指向儲存按鈕', () => {
    for (const msg of toasts) {
      expect(msg).toContain('尚未儲存');
      expect(msg).toContain(t.flexMenu.save);
    }
  });

  it('切換 handler 只 setState + toast，不呼叫儲存', () => {
    for (const key of ['enabledToast', 'fallbackHintToast', 'fallbackSilentToast', 'campaignKeywordOnToast']) {
      const idx = page.indexOf(`t.flexMenu.${key}`);
      expect(idx).toBeGreaterThan(0);
      const window = page.slice(Math.max(0, idx - 300), idx + 100);
      expect(window).not.toContain('saveFlexMenu');
    }
  });

  it('四個控制項的值只由 saveFlexMenu 持久化', () => {
    const start = page.indexOf('const saveFlexMenu');
    const body = page.slice(start, page.indexOf('const resetFlexMenu'));
    for (const f of ['flexMenuEnabled', 'flexMenuFallback', 'campaignKeywordEnabled']) {
      expect(body).toContain(f);
    }
  });
});
