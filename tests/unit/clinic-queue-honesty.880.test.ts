import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clinicQueuePage as t } from '@/i18n/zh-TW/pages/clinic-queue';

/** vitest 不轉換 TSX，改以讀取原始碼斷言（與 oauth-honest.26 相同技巧）。 */
const page = readFileSync(
  fileURLToPath(new URL('../../src/app/tenant/clinic-queue/page.tsx', import.meta.url)),
  'utf8',
);

describe('clinic-queue 真實模式誠實顯示 (#880)', () => {
  it('提供未開放文案', () => {
    expect(t.unavailable.title.length).toBeGreaterThan(0);
    expect(t.unavailable.description.length).toBeGreaterThan(0);
  });

  it('從 @/config/env 匯入 USE_MOCK', () => {
    expect(page).toMatch(/import \{ USE_MOCK \} from '@\/config\/env';/);
  });

  it('預設匯出在 !USE_MOCK 時只渲染未開放狀態，demo 元件僅在 mock 模式渲染', () => {
    const m = page.match(/export default function ClinicQueuePage\(\) \{([\s\S]*?)\n\}\n/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('if (!USE_MOCK)');
    expect(body).toContain('t.unavailable.title');
    expect(body).toContain('t.unavailable.description');
    expect(body.indexOf('DemoClinicQueuePage')).toBeGreaterThan(body.indexOf('if (!USE_MOCK)'));
    expect(body).not.toMatch(/listServices|useToast|useState|useEffect/);
  });

  it('listServices 只在 DemoClinicQueuePage 內呼叫，不在真實模式分支', () => {
    const idx = page.indexOf('function DemoClinicQueuePage()');
    expect(idx).toBeGreaterThan(0);
    const before = page.slice(0, idx);
    expect(before.match(/listServices\(/g)).toBeNull();
    expect(page.match(/listServices\(/g)?.length).toBeGreaterThan(0);
  });
});
