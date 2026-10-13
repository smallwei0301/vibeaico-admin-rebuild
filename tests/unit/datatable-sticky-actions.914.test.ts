import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stickyClass, beforeStickyClass } from '@/components/ui/DataTable';

const read = (p: string) => readFileSync(p, 'utf8');

describe('#914 DataTable sticky right column', () => {
  it('stickyClass 只在 sticky=right 時回傳 class', () => {
    expect(stickyClass({}, 'td')).toBeUndefined();
    expect(stickyClass({ sticky: undefined }, 'th')).toBeUndefined();
    expect(stickyClass({ sticky: 'right' }, 'td')).toBe('col-sticky-right');
    expect(stickyClass({ sticky: 'right' }, 'th')).toContain('col-sticky-right-head');
  });

  it('DataTable 型別與 th/td 都套用 stickyClass', () => {
    const src = read('src/components/ui/DataTable.tsx');
    expect(src).toMatch(/sticky\?: 'right'/);
    expect(src).toContain("stickyClass(c, 'th')");
    expect(src).toContain("stickyClass(c, 'td')");
  });

  it('全域樣式：sticky right、表頭交叉格層級最高、btn-group-wrap', () => {
    const css = read('src/styles/globals.css');
    expect(css).toMatch(/\.col-sticky-right\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0/);
    expect(css).toMatch(/\.data-table thead th\.col-sticky-right-head\s*\{\s*z-index:\s*3/);
    expect(css).toMatch(/\.col-sticky-right\s*\{[^}]*box-shadow:\s*var\(--shadow-sticky-edge\)/);
    expect(read('src/styles/tokens.css')).toMatch(/--shadow-sticky-edge:\s*[^;]+;/);
    expect(css).toContain('.btn-group-wrap');
    // 按鈕群組換行須與前一欄讓位同帶寬：>=1200px 才 nowrap，992–1199.98px 仍可換行
    expect(css).toMatch(/@media \(min-width:\s*1200px\)\s*\{\s*\.btn-group-wrap\s*\{[^}]*flex-nowrap/);
    expect(css).not.toMatch(/@media \(min-width:\s*992px\)\s*\{\s*\.btn-group-wrap/);
    expect(css).toMatch(/\.btn-group\s*\{[^}]*flex-nowrap/);
    // 換行上限走 token，不寫死 rem
    expect(css).toMatch(/\.btn-group-wrap\s*\{[^}]*max-width:\s*var\(--btn-group-wrap-max\)/);
    expect(read('src/styles/tokens.css')).toMatch(/--btn-group-wrap-max:\s*[\d.]+rem/);
  });

  it.each(['src/app/tenant/bookings/page.tsx', 'src/app/tenant/tour-orders/page.tsx'])(
    '%s 操作欄 sticky right 且按鈕群組可換行',
    (f) => {
      const src = read(f);
      expect(src).toMatch(/key: 'actions'[^\n]*sticky: 'right'/);
      expect(src).toContain('btn-group btn-group-wrap');
    },
  );

  it('前一欄 class 只在 sticky 表出現（未設定 sticky 的表格完全不變）', () => {
    expect(beforeStickyClass([{}, {}, {}], 0)).toBeUndefined();
    expect(beforeStickyClass([{}, {}, {}], 2)).toBeUndefined();
    const cols = [{}, {}, { sticky: 'right' as const }];
    expect(beforeStickyClass(cols, 0)).toBeUndefined();
    expect(beforeStickyClass(cols, 1)).toBe('col-before-sticky-right');
    expect(beforeStickyClass(cols, 2)).toBeUndefined();
    const src = read('src/components/ui/DataTable.tsx');
    expect(src.match(/beforeStickyClass\(columns, ci\)/g)?.length).toBe(2);
  });

  it('前一欄預留空間：<=1199.98px（含 iPad 橫向）、使用 token、clip 不出假省略號、桌機不加', () => {
    const css = read('src/styles/globals.css');
    const m = css.match(/@media \(max-width:\s*1199\.98px\)\s*\{[^@]*?col-before-sticky-right[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/padding-right:\s*var\(--sticky-actions-reserve\)/);
    expect(m![0]).toMatch(/text-overflow:\s*clip/);
    expect(css.replace(m![0], '')).not.toMatch(/col-before-sticky-right[^}]*padding-right/);
    expect(read('src/styles/tokens.css')).toMatch(/--sticky-actions-reserve:\s*[\d.]+rem/);
  });
});
