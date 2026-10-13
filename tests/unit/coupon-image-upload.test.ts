import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('票券圖片控制項誠實化', () => {
  const page = read('src/app/tenant/coupons/page.tsx');
  it('檔案輸入為 disabled 且附「尚未開放」說明', () => {
    expect(page).toMatch(/id="couponImageInput"[^>]*disabled/);
    expect(page).toContain('t.form.imageUnavailable');
    expect(read('src/i18n/zh-TW/pages/coupons.ts')).toContain('尚未開放');
  });
  it('不再提供對不存在資料的移除按鈕', () => {
    expect(page).not.toContain('imageRemove');
  });
  it('持久化鏈路缺口：services / API / mapper 皆無 imageUrl', () => {
    for (const f of ['src/services/coupons.ts', 'src/app/api/coupons/route.ts', 'src/app/api/coupons/[id]/route.ts', 'src/server/coupons.ts']) {
      expect(read(f)).not.toMatch(/imageUrl|image_url/);
    }
  });
});

describe('票券加購欄位誠實化', () => {
  const page = read('src/app/tenant/coupons/page.tsx');
  const i18n = read('src/i18n/zh-TW/pages/coupons.ts');
  it('ADDON 類型不可選且標示尚未開放保存', () => {
    expect(page).toContain("disabled={o.value === 'ADDON'}");
    expect(i18n).toContain('加購券（尚未開放保存）');
  });
  it('頁面不再渲染無法持久化的 addonItem / addonPrice', () => {
    expect(page).not.toMatch(/addonItem|addonPrice/);
  });
  it('API 的 discountType 不接受 ADDON', () => {
    expect(read('src/app/api/coupons/route.ts')).toContain("z.enum(['AMOUNT', 'PERCENT', 'GIFT'])");
  });
});
