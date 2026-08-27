/**
 * restore-previous 的 config → 重建 payload。
 *
 * `line_rich_menu_id` 已被店家在 LINE OA Manager 刪除時，route 必須從
 * RESTORE_POINT 的原始 config 重建；CUSTOM 不能經 fixed schema 吃掉、默默變成預設 3+4。
 * 實際 HTTP／DB／LINE mock 的 direct-reuse 路徑在 rich-menu-advanced 整合測試；
 * 本檔只守不碰 TEST DB 的重新組裝契約。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildRestoreRichMenuInput } from '@/server/rich-menu';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('restore-previous：失效的 LINE id 以原 config 重建', () => {
  it('CUSTOM 保留每個 area 的 bounds、action 與 theme，不回退成固定版型', () => {
    const restored = buildRestoreRichMenuInput({
      kind: 'CUSTOM',
      theme: 'DARK',
      bgImageUrl: '',
      chatBarText: '自訂功能',
      name: '兩個不等寬的格子',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1500, height: 1686 },
          label: '預約', action: 'SEND_TEXT', value: '我要預約', icon: '',
        },
        {
          bounds: { x: 1500, y: 0, width: 1000, height: 1686 },
          label: '網站', action: 'OPEN_URL', value: 'https://example.com/menu', icon: '',
        },
      ],
    }, 'LOCAL_SHOP');

    expect(restored.kind).toBe('CUSTOM');
    expect(restored.theme).toBe('DARK');
    expect(restored.payload).toMatchObject({
      chatBarText: '自訂功能',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1500, height: 1686 },
          action: { type: 'message', label: '預約', text: '我要預約' },
        },
        {
          bounds: { x: 1500, y: 0, width: 1000, height: 1686 },
          action: { type: 'uri', label: '網站', uri: 'https://example.com/menu' },
        },
      ],
    });
  });

  it('fixed config 仍以固定版型重建', () => {
    const restored = buildRestoreRichMenuInput({
      theme: 'OCEAN_BLUE', layout: '2x2', bgImageUrl: '', chatBarText: '選單', name: '固定版型',
      cells: [
        { label: '甲', action: 'SEND_TEXT', value: '甲', icon: '' },
        { label: '乙', action: 'SEND_TEXT', value: '乙', icon: '' },
        { label: '丙', action: 'SEND_TEXT', value: '丙', icon: '' },
        { label: '丁', action: 'SEND_TEXT', value: '丁', icon: '' },
      ],
    }, 'LOCAL_SHOP');

    expect(restored.kind).toBe('FIXED');
    expect(restored.theme).toBe('OCEAN_BLUE');
    expect(restored.payload.areas).toHaveLength(4);
    expect(restored.payload.areas[3].bounds).toEqual({ x: 1250, y: 843, width: 1250, height: 843 });
  });

  it('不完整／未知的 stored config 回明確 400，而不是套 schema default 發布另一張選單', () => {
    for (const invalid of [
      { kind: 'CUSTOM', theme: 'DARK', areas: [] },
      {},
      { kind: 'UNKNOWN', theme: 'DARK', layout: '3+4', cells: [] },
    ]) {
      expect(() => buildRestoreRichMenuInput(invalid, 'LOCAL_SHOP')).toThrow(expect.objectContaining({
        status: 400,
        code: 'REQ_001',
      }));
    }
  });

  it('route 保留「先嘗試直接切回舊 LINE id；失效才重建」的順序', () => {
    const route = withoutComments(src('src/app/api/settings/line/rich-menu/restore-previous/route.ts'));
    const directReuse = route.indexOf('lineSetDefaultRichMenu(token, restorePoint.line_rich_menu_id)');
    const fallback = route.indexOf('buildRestoreRichMenuInput(restorePoint.config, businessType)');
    expect(directReuse).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(directReuse);
  });
});
