import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stickyClass, beforeStickyClass, nextStickyCompact } from '@/components/ui/DataTable';

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
    // 預設 nowrap、不限寬；換行與限寬只在 [data-sticky-compact] 祖先下
    expect(css).toMatch(/\.btn-group-wrap\s*\{\s*@apply flex-nowrap;\s*\}/);
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

  it('前一欄預留空間：只在 [data-sticky-compact] 下、使用 token、clip；無 viewport 斷點', () => {
    const css = read('src/styles/globals.css');
    const m = css.match(/\[data-sticky-compact\] \.data-table \.col-before-sticky-right,[^{]*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/padding-right:\s*var\(--sticky-actions-reserve\)/);
    expect(m![0]).toMatch(/text-overflow:\s*clip/);
    expect(css.replace(m![0], '')).not.toMatch(/col-before-sticky-right[^}]*padding-right/);
    expect(read('src/styles/tokens.css')).toMatch(/--sticky-actions-reserve:\s*[\d.]+rem/);
  });

  it('不再以 viewport 斷點切換固定欄相關規則', () => {
    const css = read('src/styles/globals.css');
    expect(css).not.toMatch(/@media[^{]*(1199\.98|1200px)/);
    // 逐一取出 @media 區塊（括號配對），其內容不得含這兩個選擇器
    let i = css.indexOf('@media');
    while (i !== -1) {
      const open = css.indexOf('{', i);
      let depth = 0;
      let j = open;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}' && --depth === 0) break;
      }
      expect(css.slice(open, j + 1)).not.toMatch(/btn-group-wrap|col-before-sticky-right/);
      i = css.indexOf('@media', j);
    }
  });

  it('DataTable 只在有 sticky 欄時掛 observer 與屬性，卸載 disconnect', () => {
    const src = read('src/components/ui/DataTable.tsx');
    expect(src).toContain("columns.some((c) => c.sticky === 'right')");
    expect(src).toMatch(/if \(!enabled\) return;/);
    expect(src).toContain('new ResizeObserver');
    expect(src).toContain('ro.disconnect()');
    expect(src).toContain('useLayoutEffect');
  });
});

describe('#914 nextStickyCompact 遲滯判斷', () => {
  const m = (scrollWidth: number, clientWidth: number, threshold = scrollWidth) => ({ scrollWidth, clientWidth, threshold });

  it('進入：非 compact 且 scrollWidth > clientWidth + 1', () => {
    expect(nextStickyCompact(false, m(1000, 902))).toBe(true);
  });
  it('維持非 compact：未溢出或僅差 1px 容差', () => {
    expect(nextStickyCompact(false, m(900, 902))).toBe(false);
    expect(nextStickyCompact(false, m(903, 902))).toBe(false); // 差 1px 內
    expect(nextStickyCompact(false, m(904, 902))).toBe(true); // 差 2px
  });
  it('維持 compact：容器仍小於進入前所需寬度（不看 compact 下的 scrollWidth）', () => {
    expect(nextStickyCompact(true, { scrollWidth: 1, clientWidth: 902, threshold: 1000 })).toBe(true);
    expect(nextStickyCompact(true, { scrollWidth: 1, clientWidth: 998, threshold: 1000 })).toBe(true);
  });
  it('退出：容器寬度回到足以容納非 compact 寬度', () => {
    expect(nextStickyCompact(true, { scrollWidth: 1, clientWidth: 999, threshold: 1000 })).toBe(false); // 1px 容差邊界
    expect(nextStickyCompact(true, { scrollWidth: 1, clientWidth: 1000, threshold: 1000 })).toBe(false);
    expect(nextStickyCompact(true, { scrollWidth: 1, clientWidth: 1400, threshold: 1000 })).toBe(false);
  });
  it('門檻邊界一致：進入與退出互為補集，同一寬度不來回切換', () => {
    const sw = 1000;
    for (let cw = 800; cw <= 1200; cw++) {
      const enters = nextStickyCompact(false, m(sw, cw));
      const staysCompact = nextStickyCompact(true, { scrollWidth: 0, clientWidth: cw, threshold: sw });
      expect(staysCompact).toBe(enters);
    }
  });
  it('縮小再放大序列：只在跨越門檻時各切換一次', () => {
    const sw = 1000;
    let compact = false;
    let flips = 0;
    const widths = [1400, 1200, 1000, 999, 900, 700, 500, 700, 900, 998, 999, 1000, 1200, 1400];
    for (const cw of widths) {
      const next = nextStickyCompact(compact, { scrollWidth: compact ? 1 : sw, clientWidth: cw, threshold: sw });
      if (next !== compact) flips++;
      compact = next;
    }
    expect(flips).toBe(2);
    expect(compact).toBe(false);
  });
});
