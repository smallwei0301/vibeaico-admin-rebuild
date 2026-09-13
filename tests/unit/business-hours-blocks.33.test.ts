import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  closedIntervalsForDay,
  planAutoBlocks,
  firstOccurrenceIso,
  fallsInClosedTime,
  type BusinessHoursInput,
} from '../../src/server/business-hours-blocks';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const base: BusinessHoursInput = {
  perDayMode: true,
  perDayHours: [[], [], [], [], [], [], []],
  closedDays: [],
  businessStart: '09:00',
  businessEnd: '18:00',
  breakStart: '',
  breakEnd: '',
};

describe('#33②: 一天的營業時段 → 要封鎖的空隙', () => {
  it('沒有任何營業時段 → 整天封鎖', () => {
    expect(closedIntervalsForDay([])).toEqual([{ start: 0, end: 1440 }]);
  });

  it('單一時段 09:00-18:00 → 前後兩段空隙', () => {
    expect(closedIntervalsForDay([{ start: '09:00', end: '18:00' }]))
      .toEqual([{ start: 0, end: 540 }, { start: 1080, end: 1440 }]);
  });

  it('午休拆成兩段 → 中間那段也要封起來', () => {
    expect(closedIntervalsForDay([
      { start: '09:00', end: '12:00' },
      { start: '13:30', end: '18:00' },
    ])).toEqual([
      { start: 0, end: 540 },
      { start: 720, end: 810 },
      { start: 1080, end: 1440 },
    ]);
  });

  it('重疊的營業時段先合併，不會算出負長度的空隙', () => {
    expect(closedIntervalsForDay([
      { start: '09:00', end: '14:00' },
      { start: '12:00', end: '18:00' },
    ])).toEqual([{ start: 0, end: 540 }, { start: 1080, end: 1440 }]);
  });

  it('從 00:00 開到 24:00 → 完全沒有空隙', () => {
    expect(closedIntervalsForDay([{ start: '00:00', end: '24:00' }])).toEqual([]);
  });

  it('起訖相同的空時段被忽略（不是變成整天營業）', () => {
    expect(closedIntervalsForDay([{ start: '09:00', end: '09:00' }]))
      .toEqual([{ start: 0, end: 1440 }]);
  });
});

describe('#33②: 整週設定 → 自動封鎖計畫', () => {
  it('公休日一律整天封鎖，且標記 fullDay', () => {
    const plans = planAutoBlocks({ ...base, closedDays: [0] });
    const sunday = plans.filter((p) => p.dayOfWeek === 0);
    expect(sunday).toEqual([{ dayOfWeek: 0, startMinute: 0, endMinute: 1440, fullDay: true }]);
  });

  it('關閉逐日模式時七天共用營業時段，不會變成完全沒有封鎖', () => {
    const plans = planAutoBlocks({ ...base, perDayMode: false, closedDays: [] });
    // 七天 × 前後各一段
    expect(plans).toHaveLength(14);
    expect(plans.every((p) => !p.fullDay)).toBe(true);
  });

  it('關閉逐日模式且有休息時間 → 每天三段封鎖', () => {
    const plans = planAutoBlocks({
      ...base, perDayMode: false, breakStart: '12:00', breakEnd: '13:00',
    });
    expect(plans).toHaveLength(21);
    expect(plans.filter((p) => p.dayOfWeek === 1)).toEqual([
      { dayOfWeek: 1, startMinute: 0, endMinute: 540, fullDay: false },
      { dayOfWeek: 1, startMinute: 720, endMinute: 780, fullDay: false },
      { dayOfWeek: 1, startMinute: 1080, endMinute: 1440, fullDay: false },
    ]);
  });

  it('逐日模式下沒填時段的那天 → 整天封鎖', () => {
    const perDayHours = [[], [{ start: '10:00', end: '19:00' }], [], [], [], [], []];
    const plans = planAutoBlocks({ ...base, perDayHours });
    expect(plans.filter((p) => p.dayOfWeek === 0)[0].fullDay).toBe(true);
    expect(plans.filter((p) => p.dayOfWeek === 1)).toHaveLength(2);
  });
});

describe('#33②: WEEKLY 首次發生的時間換算（台北 +08:00）', () => {
  it('取 now 起往後第一個符合星期的日期，含當天', () => {
    // 2026-09-07T00:00:00Z = 台北 2026-09-07 08:00，星期一(1)
    const now = new Date('2026-09-07T00:00:00Z');
    const { startAt, endAt } = firstOccurrenceIso(
      { dayOfWeek: 1, startMinute: 540, endMinute: 1080, fullDay: false }, now,
    );
    // 台北 2026-09-07 09:00 = 01:00Z 同日
    expect(startAt).toBe('2026-09-07T01:00:00.000Z');
    expect(endAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('星期較早時往後跨到下一週的那一天', () => {
    const now = new Date('2026-09-07T00:00:00Z'); // 台北週一
    const { startAt } = firstOccurrenceIso(
      { dayOfWeek: 0, startMinute: 0, endMinute: 1440, fullDay: true }, now,
    );
    // 下一個週日 = 2026-09-13，台北 00:00 = 2026-09-12T16:00Z
    expect(startAt).toBe('2026-09-12T16:00:00.000Z');
  });
});

describe('#33②: 既有預約是否落在新的非營業時段', () => {
  const plans = planAutoBlocks({
    ...base, perDayMode: false, businessStart: '09:00', businessEnd: '18:00',
  });

  it('台北時間 08:00 的預約落在營業前 → 算衝突', () => {
    expect(fallsInClosedTime('2026-09-07T00:00:00Z', plans)).toBe(true);
  });

  it('台北時間 10:00 的預約在營業中 → 不算衝突', () => {
    expect(fallsInClosedTime('2026-09-07T02:00:00Z', plans)).toBe(false);
  });

  it('剛好等於營業開始時間（09:00）→ 不算衝突（半開區間）', () => {
    expect(fallsInClosedTime('2026-09-07T01:00:00Z', plans)).toBe(false);
  });

  it('剛好等於營業結束時間（18:00）→ 算衝突（已在關門後的區間內）', () => {
    expect(fallsInClosedTime('2026-09-07T10:00:00Z', plans)).toBe(true);
  });
});

/* ------------------------------------------------------- 靜態鏈路與不變式 */
const module_ = read('src/server/business-hours-blocks.ts');
const draftRoute = read('src/app/api/settings/weekly-business-hours/draft/route.ts');
const settingsRoute = read('src/app/api/settings/route.ts');
const page = read('src/app/tenant/settings/page.tsx');
const service = read('src/services/settings.ts');

describe('#33②: 不變式與接線', () => {
  it('刪除自動封鎖時永遠帶 auto=true——手動建立的一列都不能被刪', () => {
    const deleteBlock = module_.slice(module_.indexOf('.delete()'), module_.indexOf('.delete()') + 200);
    expect(deleteBlock).toContain(".eq('auto', true)");
  });

  it('乾跑端點不含任何寫入呼叫', () => {
    for (const verb of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(draftRoute).not.toContain(verb);
    }
    expect(draftRoute).toContain('measureBusinessHoursImpact');
  });

  it('measureBusinessHoursImpact 本身也不寫入（乾跑的真正實作在這裡）', () => {
    const start = module_.indexOf('export async function measureBusinessHoursImpact');
    const end = module_.indexOf('export async function rebuildAutoBlocks');
    const body = module_.slice(start, end);
    for (const verb of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(body).not.toContain(verb);
    }
  });

  it('「乾跑是我方選的」與反面證據都寫在檔頭，不是只寫結論', () => {
    expect(module_).toContain('我方選定');
    expect(module_).toContain('反面證據');
    expect(module_).toContain('這個解讀沒有原站證據');
  });

  it('PUT /api/settings 帶 business 才重建自動封鎖', () => {
    expect(settingsRoute).toContain('if (b.business) {');
    expect(settingsRoute).toContain('rebuildAutoBlocks(t.supabase, t.tenantId, b.business)');
  });

  it('四句既有文案都真的被引用了（本 issue 之前引用數是 0）', () => {
    for (const key of [
      't.business.autoBlockCreated(',
      't.business.conflictWarning(',
      't.business.conflictWarningHours(',
      't.business.manualBlockKept(',
    ]) {
      expect(page).toContain(key);
    }
  });

  it('零筆時不顯示那一句——不是顯示「0 筆」的警告', () => {
    expect(page).toContain('created > 0');
    expect(page).toContain('conflicts > 0');
    expect(page).toContain('manualKept > 0');
  });

  it('骨架模式回 null 代表「算不出來」，不是編一個數字', () => {
    const start = service.indexOf('export const previewBusinessHours');
    const body = service.slice(start, start + 500);
    expect(body).toContain('() => null,');
  });
});
