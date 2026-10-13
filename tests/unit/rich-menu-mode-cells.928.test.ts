import { describe, it, expect } from 'vitest';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { buildRichMenuBody, RICH_MENU_CELL_BOUNDS, resolveRichMenuBusinessType } from '@/server/rich-menu';

const MODES = Object.keys(MODE_PRESETS) as BusinessType[];
const LEGACY_BOUNDS = [
  [0, 0, 833, 843], [833, 0, 833, 843], [1666, 0, 834, 843],
  [0, 843, 833, 843], [833, 843, 833, 843], [1666, 843, 834, 843],
];

describe('#928 基本圖文選單依營業模式產生六格', () => {
  it.each(MODES)('%s：6 個 areas，label／text 等於 preset，bounds 不變', (mode) => {
    const body = buildRichMenuBody('LINE_GREEN', mode);
    expect(body.areas).toHaveLength(6);
    body.areas.forEach((a, i) => {
      const cell = MODE_PRESETS[mode].richMenuCells[i];
      expect(a.action).toEqual({ type: 'message', label: cell.label, text: cell.text });
      const [x, y, w, h] = LEGACY_BOUNDS[i];
      expect(a.bounds).toEqual({ x, y, width: w, height: h });
    });
    expect(body.size).toEqual({ width: 2500, height: 1686 });
    expect(RICH_MENU_CELL_BOUNDS).toHaveLength(6);
  });

  it('LOCAL_SHOP：text 與順序和改動前完全一致', () => {
    const body = buildRichMenuBody('LINE_GREEN', 'LOCAL_SHOP');
    expect(body.areas.map((a) => a.action.text)).toEqual(['預約', '我的預約', '服務項目', '會員卡', '優惠', '聯絡我們']);
    expect(body.name).toBe('vibeai-line_green');
    expect(body.chatBarText).toBe('選單');
  });

  it('GUIDE：選單可進入行程、團次與我的訂單', () => {
    const texts = buildRichMenuBody('X', 'GUIDE').areas.map((a) => a.action.text);
    expect(texts).toEqual(expect.arrayContaining(['行程', '團次', '我的訂單']));
  });

  it.each([undefined, null, '', 'UNKNOWN', 'toString', 42])('非法或缺漏 %s 回退 LOCAL_SHOP', (bad) => {
    expect(resolveRichMenuBusinessType(bad)).toBe('LOCAL_SHOP');
    expect(buildRichMenuBody('X', bad).areas.map((a) => a.action)).toEqual(
      buildRichMenuBody('X', 'LOCAL_SHOP').areas.map((a) => a.action),
    );
  });

  it('所有模式的 label 長度不超過 LINE 上限 20 字', () => {
    for (const mode of MODES) {
      for (const a of buildRichMenuBody('X', mode).areas) {
        expect(a.action.label.length).toBeGreaterThan(0);
        expect(a.action.label.length).toBeLessThanOrEqual(20);
        expect(a.action.text.length).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe('#928 LINE 設定的選單預覽與發布同源', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const page = fs.readFileSync('src/app/tenant/line-settings/page.tsx', 'utf8');
  const i18n = fs.readFileSync('src/i18n/zh-TW/pages/line-settings.ts', 'utf8');

  it('預覽為 3 欄六格，格子文字取自目前營業模式的 richMenuCells', () => {
    expect(page).toContain('useBusinessType()');
    expect(page).toContain('MODE_PRESETS[previewBusinessType].richMenuCells.map');
    expect(page).toMatch(/grid grid-cols-3 gap-px/);
    expect(page).not.toContain('previewItems');
    for (const mode of MODES) expect(MODE_PRESETS[mode].richMenuCells).toHaveLength(6);
  });

  it('有 previewNote 說明文字不會畫進圖片，且不再有寫死的預覽字樣', () => {
    expect(page).toContain('t.richMenu.previewNote');
    expect(i18n).toMatch(/previewNote:[\s\S]*不會畫進圖片/);
    expect(i18n).not.toContain('previewItems');
    expect(i18n).not.toContain('瀏覽商品');
  });
});
