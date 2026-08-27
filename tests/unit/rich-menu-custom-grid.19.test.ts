/**
 * issue #19：原站可見的「自訂格數」UI 與 create-custom 接線。
 *
 * DOM 規格只證明店家可選 1–4 行、1–5 列，套用後逐格設定功能；它沒有留下
 * 座標 payload 的演算法。因此等分格線是本專案明示的實作選擇，不是還原宣稱。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { customGridBounds } from '@/config/rich-menu-custom-grid';
import { RICH_MENU_HEIGHT, RICH_MENU_WIDTH } from '@/config/rich-menu-layouts';
import { decodePublishedRichMenuConfig } from '@/lib/rich-menu-published-config';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('issue #19：自訂格數', () => {
  it('2 行 × 3 列產生六個等分區塊，完整覆蓋 LINE 畫布', () => {
    expect(customGridBounds(2, 3)).toEqual([
      { x: 0, y: 0, width: 833, height: 843 },
      { x: 833, y: 0, width: 833, height: 843 },
      { x: 1666, y: 0, width: 834, height: 843 },
      { x: 0, y: 843, width: 833, height: 843 },
      { x: 833, y: 843, width: 833, height: 843 },
      { x: 1666, y: 843, width: 834, height: 843 },
    ]);
    const last = customGridBounds(2, 3).at(-1)!;
    expect(last.x + last.width).toBe(RICH_MENU_WIDTH);
    expect(last.y + last.height).toBe(RICH_MENU_HEIGHT);
  });

  it('只接受原站可見的 1–4 行與 1–5 列', () => {
    expect(() => customGridBounds(0, 3)).toThrow(RangeError);
    expect(() => customGridBounds(5, 3)).toThrow(RangeError);
    expect(() => customGridBounds(2, 0)).toThrow(RangeError);
    expect(() => customGridBounds(2, 6)).toThrow(RangeError);
  });

  it('已發布的規則自訂格數會還原行列與逐格設定，而不是回退成固定版型', () => {
    const areas = customGridBounds(2, 3).map((bounds, index) => ({
      bounds,
      label: `格 ${index + 1}`,
      action: 'SEND_TEXT' as const,
      value: `文字 ${index + 1}`,
      icon: '',
    }));
    expect(decodePublishedRichMenuConfig({ kind: 'CUSTOM', theme: 'DARK', areas })).toEqual({
      kind: 'CUSTOM_GRID',
      theme: 'DARK',
      grid: { rows: 2, columns: 3 },
      cells: areas.map(({ bounds: _bounds, ...cell }) => cell),
    });
  });

  it('已發布的任意座標不是規則格線時保持不可編輯，不得假裝是 3+4', () => {
    expect(decodePublishedRichMenuConfig({
      kind: 'CUSTOM',
      theme: 'DARK',
      areas: [
        { bounds: { x: 0, y: 0, width: 1500, height: 1686 }, label: '左', action: 'SEND_TEXT', value: '左', icon: '' },
        { bounds: { x: 1500, y: 0, width: 1000, height: 1686 }, label: '右', action: 'SEND_TEXT', value: '右', icon: '' },
      ],
    })).toMatchObject({ kind: 'UNSUPPORTED_CUSTOM' });
  });

  it('頁面有行／列選擇與套用，並把逐格設定連到既有 create-custom service', () => {
    const page = withoutComments(src('src/app/tenant/rich-menu-design/page.tsx'));
    expect(page).toContain("createCustomRichMenu");
    expect(page).toContain("t.layout.customRows");
    expect(page).toContain("t.layout.customColumns");
    expect(page).toContain("t.layout.applyCustomGrid");
    expect(page).toContain("customGridBounds(customGrid.rows, customGrid.columns)");
    expect(page).toContain("await createCustomRichMenu(customDesignPayload())");
    expect(page).toContain("t.layout.customBindingChoice");
    expect(page).toContain('decodePublishedRichMenuConfig(config.published.config)');
    expect(page).not.toContain('source.layout');
    expect(page).not.toContain('source.cells');
    expect(page).toContain('{t.layout.publishedConfigUnavailable}');
    expect(page).toContain('setEditorReadOnly(cannotRepresent || publishedCannotRepresent)');
    expect(page).toContain('disabled={editorReadOnly}');
  });
});
