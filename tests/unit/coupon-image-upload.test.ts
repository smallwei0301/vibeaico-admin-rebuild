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
