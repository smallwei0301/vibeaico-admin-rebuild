/**
 * issue #903 — 預約批次確認／取消部分失敗的如實回報，與編輯預約人員下拉對齊目前指定人員。
 * node 環境無法掛載元件，接線以讀原始碼斷言，邏輯以純函式直接測試。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bookingsPage as t } from '@/i18n/zh-TW/pages/bookings';
import { buildStaffOptions, summarizeBatch } from '@/lib/booking-batch';

const src = readFileSync(
  fileURLToPath(new URL('../../src/app/tenant/bookings/page.tsx', import.meta.url)),
  'utf8',
);

describe('#903 批次處理接線', () => {
  it('批次確認與取消都用 allSettled，不再用 Promise.all', () => {
    expect(src).toContain('Promise.allSettled(ids.map((id) => confirmBooking(id)))');
    expect(src).toContain('Promise.allSettled(ids.map((id) => cancelBooking(id)))');
    expect(src).not.toMatch(/Promise\.all\(ids/);
  });

  it('兩處批次在結果後都呼叫 load，且部分失敗只保留失敗 id', () => {
    const blocks = src.split('Promise.allSettled(').slice(1);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      const seg = b.slice(0, 900);
      expect(seg).toContain('void load();');
      expect(seg).toContain("t.messages.batchPartial(succeeded.length, failed.length), 'warning'");
      expect(seg).toContain('setSelected(failed)');
    }
  });
});

describe('#903 summarizeBatch 與文案', () => {
  it('依序分出成功與失敗 id', () => {
    const r = summarizeBatch(['a', 'b', 'c'], [
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('x') },
      { status: 'fulfilled', value: 2 },
    ]);
    expect(r).toEqual({ succeeded: ['a', 'c'], failed: ['b'] });
  });

  it('部分失敗文案分別計數', () => {
    expect(t.messages.batchPartial(3, 2)).toBe('成功 3 筆、失敗 2 筆');
  });
});

describe('#903 編輯預約人員選項', () => {
  const staff = [
    { id: 's1', name: 'A', bookable: true },
    { id: 's2', name: 'B', bookable: false },
  ];

  it('目前指定人員為可預約時不重複', () => {
    expect(buildStaffOptions(staff, 's1').map((o) => o.value)).toEqual(['s1']);
  });

  it('目前指定人員非 bookable 仍列出並標示', () => {
    const o = buildStaffOptions(staff, 's2');
    expect(o.map((x) => x.value)).toEqual(['s1', 's2']);
    expect(o[1].kind).toBe('currentInactive');
    expect(t.createModal.staffCurrentInactive('B')).toBe('B（目前指定・已停止接受預約）');
  });

  it('staffId 不在清單中仍補上對應選項', () => {
    const o = buildStaffOptions([], 'gone');
    expect(o).toEqual([{ value: 'gone', kind: 'currentUnknown', name: '' }]);
    expect(t.createModal.staffCurrentUnknown).toBe('目前指定人員');
  });

  it('未指定時不加選項，頁面使用該 helper', () => {
    expect(buildStaffOptions(staff, '').map((o) => o.value)).toEqual(['s1']);
    expect(src).toContain('buildStaffOptions(staff, staffId)');
  });
});
