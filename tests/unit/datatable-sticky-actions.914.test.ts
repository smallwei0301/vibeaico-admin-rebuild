import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stickyClass } from '@/components/ui/DataTable';

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
    expect(css).toMatch(/\.btn-group\s*\{[^}]*flex-nowrap/);
  });

  it.each(['src/app/tenant/bookings/page.tsx', 'src/app/tenant/tour-orders/page.tsx'])(
    '%s 操作欄 sticky right 且按鈕群組可換行',
    (f) => {
      const src = read(f);
      expect(src).toMatch(/key: 'actions'[^\n]*sticky: 'right'/);
      expect(src).toContain('btn-group btn-group-wrap');
    },
  );
});
