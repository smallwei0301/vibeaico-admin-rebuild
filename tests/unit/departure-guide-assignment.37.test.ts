/**
 * tests/unit/departure-guide-assignment.37.test.ts — issue #37 的規則層
 *
 * ⚠️ 這個檔驗證的是**純函式**：0/1/2+ 的解析、團次佔用區間的算法、以及撞班判斷。
 * 它**不**驗證 API 真的把指派寫進了資料庫，也不驗證 `available-slots` 真的排除了
 * 被指派的人——那兩件事只有整合測試（真 DB ＋ 真 HTTP）證明得了，見
 * `tests/integration/api/departure-guide-assignment.37.test.ts`。
 *
 * 把界線寫在這裡，是因為這個專案已經被「測試名稱宣稱得比它證明的多」咬過
 * （PB-029）。這裡的每一條都只宣稱它真的驗到的那一件事。
 */
import { describe, expect, it } from 'vitest';
import { ApiHttpError } from '@/server/http';
import { resolveAssignment } from '@/server/departure-staff';
import {
  departureInterval, findStaffConflicts, overlaps, taipeiDayStartMs, type StaffLoad,
} from '@/server/staff-availability';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const emptyLoad = (patch: Partial<StaffLoad> = {}): StaffLoad => ({
  bookings: [], blocks: [], shifts: [], shiftDates: new Set<string>(), departures: [], ...patch,
});

describe('0/1/2+ 自動適應（Owner 2026-08-27：不做 SOLO／TEAM 開關）', () => {
  it('0 位可接案導遊：OPEN 團次被擋下，且錯誤說得出要去哪裡處理', () => {
    let thrown: unknown;
    try {
      resolveAssignment({ requested: {}, bookable: [], status: 'OPEN' });
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ApiHttpError);
    expect((thrown as ApiHttpError).status).toBe(400);
    // 「請先新增導遊」必須指得出去哪裡新增，否則店家只知道被擋、不知道怎麼辦
    expect((thrown as ApiHttpError).message).toContain('員工');
  });

  it('0 位可接案導遊：CLOSED／CANCELLED 團次仍可儲存', () => {
    // 擋 OPEN 是為了不產生「開放報名卻沒人帶」的團；連把舊團關掉都擋下來就只是卡住店家。
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      expect(resolveAssignment({ requested: {}, bookable: [], status }))
        .toEqual({ primaryStaffId: null, assistantStaffIds: [] });
    }
  });

  it('1 位可接案導遊：請求沒帶 primaryStaffId 時由 server 自動指派為 PRIMARY', () => {
    // 單人店的畫面根本不顯示選擇器，所以請求裡不會有 primaryStaffId。少了這一步，
    // 單人店開的每一團都會是「未指派」——正是 §3 明文禁止的未指派半成品。
    expect(resolveAssignment({ requested: {}, bookable: [A], status: 'OPEN' }))
      .toEqual({ primaryStaffId: A, assistantStaffIds: [] });
  });

  it('2 位以上：沒指定主導遊時擋下，訊息說得出「目前是未指派」', () => {
    let thrown: unknown;
    try {
      resolveAssignment({ requested: {}, bookable: [A, B], status: 'OPEN' });
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ApiHttpError);
    expect((thrown as ApiHttpError).message).toContain('未指派');
  });

  it('2 位以上：指定主導遊與協同導遊時原樣採用，協同去重', () => {
    expect(resolveAssignment({
      requested: { primaryStaffId: A, assistantStaffIds: [B, C, B] },
      bookable: [A, B, C], status: 'OPEN',
    })).toEqual({ primaryStaffId: A, assistantStaffIds: [B, C] });
  });

  it('同一人不能同時是主導遊與協同導遊', () => {
    expect(() => resolveAssignment({
      requested: { primaryStaffId: A, assistantStaffIds: [A] },
      bookable: [A, B], status: 'OPEN',
    })).toThrow(/不能同時/);
  });

  it('更新時沒帶的欄位沿用既有指派，不被當成「清空」', () => {
    // 這一條擋的是「只改名額」的儲存把既有協同導遊靜默刪掉。
    expect(resolveAssignment({
      requested: {}, bookable: [A, B, C], status: 'OPEN',
      existing: { primaryStaffId: A, assistantStaffIds: [B] },
    })).toEqual({ primaryStaffId: A, assistantStaffIds: [B] });
  });

  it('明確傳 null 才是清空主導遊；CLOSED 團次可以真的沒有主導遊', () => {
    expect(resolveAssignment({
      requested: { primaryStaffId: null }, bookable: [A, B], status: 'CLOSED',
      existing: { primaryStaffId: A, assistantStaffIds: [] },
    })).toEqual({ primaryStaffId: null, assistantStaffIds: [] });
  });

  it('§1.3：重新編輯一個 OPEN 的舊未指派團次時，仍要求指定主導遊', () => {
    // 相容策略允許舊資料「未指派」，但同一句話接著說「新建或**重新編輯**且狀態為
    // OPEN 的團次，完成後必須有一位 PRIMARY」。只做前半句就等於永遠不會補上。
    expect(() => resolveAssignment({
      requested: {}, bookable: [A, B], status: 'OPEN',
      existing: { primaryStaffId: null, assistantStaffIds: [] },
    })).toThrow(/未指派/);
  });
});

describe('團次佔用區間', () => {
  it('有出發時間且時長已知 → 從該時間起算', () => {
    const i = departureInterval({ departsOn: '2026-03-02', startTime: '09:00', durationHours: 3 });
    expect(i.wholeDay).toBe(false);
    // 台北 09:00 = UTC 01:00
    expect(new Date(i.start).toISOString()).toBe('2026-03-02T01:00:00.000Z');
    expect(new Date(i.end).toISOString()).toBe('2026-03-02T04:00:00.000Z');
  });

  it('沒有出發時間 → 整日佔用', () => {
    const i = departureInterval({ departsOn: '2026-03-02', startTime: null, durationHours: 3 });
    expect(i.wholeDay).toBe(true);
    expect(i.end - i.start).toBe(24 * 60 * 60 * 1000);
  });

  it('⚠️ 時長未知（duration_hours 為 null 或 0）→ 也整日佔用，方向偏保守', () => {
    // 規格 §5.3 寫的是 `plan.duration_minutes`，但那個欄位不存在（見
    // staff-availability.ts 檔頭）。算不出結束時間時若當作「不佔用」，同一位導遊
    // 就會被排進兩團而完全沒有錯誤——寧可多擋，多擋店家看得到原因。
    for (const durationHours of [null, 0]) {
      const i = departureInterval({ departsOn: '2026-03-02', startTime: '09:00', durationHours });
      expect(i.wholeDay).toBe(true);
      expect(i.end - i.start).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('台北日界：整日區間的起點是台北 00:00（UTC 前一天 16:00）', () => {
    expect(new Date(taipeiDayStartMs('2026-03-02')).toISOString()).toBe('2026-03-01T16:00:00.000Z');
  });

  it('overlaps 採半開區間：接續但不重疊的兩段不算撞班', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe('撞班判斷（findStaffConflicts）', () => {
  const slot = { start: Date.parse('2026-03-02T01:00:00Z'), end: Date.parse('2026-03-02T04:00:00Z') };
  const date = '2026-03-02';

  it('沒有任何負載 → 沒有衝突', () => {
    expect(findStaffConflicts([A, B], slot, date, emptyLoad())).toEqual([]);
  });

  it('一般服務預約重疊 → BOOKING，且回得出是哪一段時間', () => {
    const load = emptyLoad({
      bookings: [{ staffId: A, start: Date.parse('2026-03-02T02:00:00Z'), end: Date.parse('2026-03-02T03:00:00Z') }],
    });
    const [conflict] = findStaffConflicts([A], slot, date, load);
    expect(conflict.reason).toBe('BOOKING');
    expect(conflict.conflictStart).toBe('2026-03-02T02:00:00.000Z');
    expect(conflict.conflictEnd).toBe('2026-03-02T03:00:00.000Z');
  });

  it('別人的預約不影響本人（不得用全店粗略封鎖，§5.4）', () => {
    const load = emptyLoad({
      bookings: [{ staffId: B, start: slot.start, end: slot.end }],
    });
    expect(findStaffConflicts([A], slot, date, load)).toEqual([]);
  });

  it('全店封鎖（staffId = null）會擋下所有人；個人封鎖只擋本人', () => {
    const shopWide = emptyLoad({ blocks: [{ staffId: null, start: slot.start, end: slot.end }] });
    expect(findStaffConflicts([A, B], slot, date, shopWide).map((c) => c.staffId)).toEqual([A, B]);
    const personal = emptyLoad({ blocks: [{ staffId: B, start: slot.start, end: slot.end }] });
    expect(findStaffConflicts([A, B], slot, date, personal).map((c) => c.staffId)).toEqual([B]);
  });

  it('其他團次重疊 → DEPARTURE，且指得出是哪一團', () => {
    const load = emptyLoad({
      departures: [{ departureId: 'dep-1', staffId: A, start: slot.start, end: slot.end }],
    });
    const [conflict] = findStaffConflicts([A], slot, date, load);
    expect(conflict.reason).toBe('DEPARTURE');
    expect(conflict.departureId).toBe('dep-1');
  });

  it('班表慣例：該租戶當日完全沒有班表資料 → 視為可排（沿用 available-slots 的既有決策）', () => {
    expect(findStaffConflicts([A], slot, date, emptyLoad())).toEqual([]);
  });

  it('班表慣例：當日有班表資料時，沒排班的人視為不上班 → SHIFT', () => {
    const load = emptyLoad({
      shiftDates: new Set([date]),
      shifts: [{
        staffId: B, workDate: date,
        start: Date.parse('2026-03-02T00:00:00Z'), end: Date.parse('2026-03-02T10:00:00Z'),
      }],
    });
    const conflicts = findStaffConflicts([A, B], slot, date, load);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ staffId: A, reason: 'SHIFT' });
  });

  it('班表慣例：班段沒有涵蓋整個團次時段 → 仍是 SHIFT', () => {
    const load = emptyLoad({
      shiftDates: new Set([date]),
      shifts: [{
        staffId: A, workDate: date,
        start: Date.parse('2026-03-02T01:00:00Z'), end: Date.parse('2026-03-02T03:00:00Z'), // 早一小時下班
      }],
    });
    expect(findStaffConflicts([A], slot, date, load)[0]).toMatchObject({ reason: 'SHIFT' });
  });

  it('多位人員各自判斷：主導遊沒事、協同導遊撞班時只回協同那一筆', () => {
    // PRIMARY 與 ASSISTANT 都占用時間（§5.3），所以協同導遊撞班一樣要擋下整次儲存。
    const load = emptyLoad({
      departures: [{ departureId: 'dep-1', staffId: B, start: slot.start, end: slot.end }],
    });
    const conflicts = findStaffConflicts([A, B], slot, date, load);
    expect(conflicts.map((c) => c.staffId)).toEqual([B]);
  });
});
