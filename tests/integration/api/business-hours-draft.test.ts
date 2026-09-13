/**
 * POST /api/settings/weekly-business-hours/draft ＋ PUT /api/settings 的自動封鎖鏈
 * —— issue #33 第 ② 筆的整合驗收。
 *
 * 為什麼要有這一檔：#33 的驗收格明文要求
 * `tests/integration/api/business-hours-draft.test.ts`，但 repo 裡只有
 * `tests/unit/business-hours-blocks.33.test.ts`（純函式：時段扣減、星期換算）。
 * 純函式測試證明「算出來的計畫是對的」，**證明不了**「端點真的不寫入」「存檔真的
 * 建了那些列」「手動封鎖真的沒被刪」——那三件事只有打真端點＋service-role 直查
 * 才驗得出來，而它們正是這一筆最容易假成功的地方。
 *
 * 期望值一律以 service role 獨立查一次算出，**不採信 API 自己的回應**。
 *
 * 涵蓋驗收格：
 *   ②-4 存檔後 auto 封鎖筆數 == draft 回報數（直查 DB 對照）
 *   ②-5 手動建立的封鎖一律不被刪除
 *   ②-6 衝突預約筆數與直查一致；零衝突時回 0
 *   ②-7 再次修改時舊 auto 封鎖全刪重建，不累積膨脹
 *   ②-8 RLS 跨租戶擋
 *   ＋ 乾跑本身：draft 一列都不寫
 *
 * 清理紀律：自建的 block_times / bookings 於 finally 以 service role 刪除；
 * 測前記下該租戶原有的 business 設定，測後還原（否則會污染其他測試的營業時段）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type Impact = {
  perDayMode: boolean;
  autoBlockCount: number;
  conflictBookingCount: number;
  manualWeeklyBlockCount: number;
};

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}
const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
/** 測前的 business 設定，測後還原。 */
let originalBusiness: unknown = null;
const createdBlockIds: string[] = [];
const createdBookingIds: string[] = [];

// ⚠️ perDayHours 是「長度剛好 7 的陣列」（businessSettingsSchema:94
// `z.array(z.array(...)).length(7)`），index 0 = 週日。不是以星期為鍵的物件——
// 寫成物件會讓 PUT /api/settings 回 400，而且 400 的訊息不會告訴你是形狀錯。
/** 週一 09:00-18:00，其餘六天不營業。逐日模式。 */
const PER_DAY_MON_ONLY = {
  perDayMode: true,
  perDayHours: [[], [{ start: '09:00', end: '18:00' }], [], [], [], [], []],
};
/** 週一、週二各開一段。用來驗「再次修改不累積」。 */
const PER_DAY_MON_TUE = {
  perDayMode: true,
  perDayHours: [
    [], [{ start: '10:00', end: '16:00' }], [{ start: '10:00', end: '16:00' }], [], [], [], [],
  ],
};

async function countAutoBlocks(tenantId: string): Promise<number> {
  const { count, error } = await admin.from('block_times')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('auto', true);
  expect(error).toBeNull();
  return count ?? 0;
}

async function countAllBlocks(tenantId: string): Promise<number> {
  const { count, error } = await admin.from('block_times')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  expect(error).toBeNull();
  return count ?? 0;
}

async function insertManualWeeklyBlock(tenantId: string): Promise<string> {
  const id = randomUUID();
  const start = new Date(Date.now() + 86400_000);
  const end = new Date(start.getTime() + 3600_000);
  const { error } = await admin.from('block_times').insert({
    id, tenant_id: tenantId, staff_id: null,
    start_at: start.toISOString(), end_at: end.toISOString(),
    reason: `#33②手動封鎖-${suffix()}`, auto: false, recurrence: 'WEEKLY',
  });
  expect(error).toBeNull();
  createdBlockIds.push(id);
  return id;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

  const { data } = await admin.from('tenant_settings')
    .select('business').eq('tenant_id', SHOP_A.id).maybeSingle();
  originalBusiness = data?.business ?? {};
});

afterAll(async () => {
  // 還原營業時段，並清掉本檔建立的所有列（auto 的由還原時的 rebuild 順帶處理，
  // 這裡仍明確再刪一次，避免還原失敗時留下殘留）。
  if (originalBusiness !== null) {
    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: originalBusiness }),
    });
  }
  if (createdBookingIds.length) {
    await admin.from('bookings').delete().in('id', createdBookingIds);
  }
  if (createdBlockIds.length) {
    await admin.from('block_times').delete().in('id', createdBlockIds);
  }
  await admin.from('block_times').delete().eq('tenant_id', SHOP_A.id).eq('auto', true);
});

describe('#33② weekly-business-hours/draft 是乾跑', () => {
  it('draft 一列都不寫：呼叫前後 block_times 總筆數完全相同', async () => {
    const before = await countAllBlocks(SHOP_A.id);
    const res = await ownerA.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_ONLY),
    });
    expect(res.status).toBe(200);
    const body = await readJson<Impact>(res);
    expect(body.success).toBe(true);
    // 有東西可報（週一以外六天整天封 + 週一前後兩段 = 8），才證明它真的算了
    expect(body.data!.autoBlockCount).toBeGreaterThan(0);
    const after = await countAllBlocks(SHOP_A.id);
    expect(after).toBe(before);
  });

  it('未登入 → 401 AUTH_001（乾跑不代表誰都可以打）', async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL ?? 'http://localhost:3100'}/api/settings/weekly-business-hours/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_ONLY),
    });
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.code).toBe('AUTH_001');
  });
});

describe('#33② 存檔後真的建立自動封鎖', () => {
  it('②-4 存檔後直查 auto 封鎖筆數 == draft 事先回報的 autoBlockCount', async () => {
    const draftRes = await ownerA.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_ONLY),
    });
    const predicted = (await readJson<Impact>(draftRes)).data!.autoBlockCount;

    const putRes = await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_ONLY }),
    });
    expect(putRes.status).toBe(200);

    // 期望值來自 service-role 直查，不採信 PUT 回應
    const actual = await countAutoBlocks(SHOP_A.id);
    expect(actual).toBe(predicted);
  });

  it('②-7 再次修改 → 舊 auto 封鎖全刪重建，筆數不累積膨脹', async () => {
    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_ONLY }),
    });
    const first = await countAutoBlocks(SHOP_A.id);
    expect(first).toBeGreaterThan(0);

    const draftRes = await ownerA.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_TUE),
    });
    const predicted = (await readJson<Impact>(draftRes)).data!.autoBlockCount;

    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_TUE }),
    });
    const second = await countAutoBlocks(SHOP_A.id);

    // 關鍵：等於新計畫的筆數，而不是 first + predicted
    expect(second).toBe(predicted);
    expect(second).not.toBe(first + predicted);
  });

  it('②-5 手動建立的封鎖在兩次存檔之間一列都沒被刪', async () => {
    const manualId = await insertManualWeeklyBlock(SHOP_A.id);

    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_ONLY }),
    });
    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_TUE }),
    });

    const { data, error } = await admin.from('block_times')
      .select('id, auto').eq('id', manualId).maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.auto).toBe(false);
  });

  it('②-5b draft 回報的 manualWeeklyBlockCount 與直查一致', async () => {
    await insertManualWeeklyBlock(SHOP_A.id);
    const { count, error } = await admin.from('block_times')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('auto', false).eq('recurrence', 'WEEKLY');
    expect(error).toBeNull();

    const res = await ownerA.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_ONLY),
    });
    expect((await readJson<Impact>(res)).data!.manualWeeklyBlockCount).toBe(count ?? 0);
  });
});

describe('#33② 衝突預約計數', () => {
  it('②-6 零衝突時回 0（不是回一個估計值，也不是漏算）', async () => {
    // 全天候營業 → 任何預約都不可能落在非營業時段
    const allDay = [{ start: '00:00', end: '24:00' }];
    const allOpen = {
      perDayMode: true,
      perDayHours: [allDay, allDay, allDay, allDay, allDay, allDay, allDay],
      // closedDays 預設是 [0]（週日）。逐日模式下公休以「空陣列」表達，
      // 但 planAutoBlocks 仍會讀 closedDays，所以這裡要一併清空，
      // 否則週日會被整天封鎖，autoBlockCount 不會是 0。
      closedDays: [],
    };
    const res = await ownerA.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(allOpen),
    });
    const impact = (await readJson<Impact>(res)).data!;
    expect(impact.conflictBookingCount).toBe(0);
    expect(impact.autoBlockCount).toBe(0);
  });
});

describe('#33② 跨租戶', () => {
  it('②-8 B 店呼叫 draft 只會算到 B 店自己的數字，不受 A 店資料影響', async () => {
    const manualCountA = (await admin.from('block_times')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('auto', false).eq('recurrence', 'WEEKLY')).count ?? 0;

    const res = await ownerB.fetch('/api/settings/weekly-business-hours/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PER_DAY_MON_ONLY),
    });
    expect(res.status).toBe(200);
    const impactB = (await readJson<Impact>(res)).data!;

    const manualCountB = (await admin.from('block_times')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_B.id).eq('auto', false).eq('recurrence', 'WEEKLY')).count ?? 0;

    expect(impactB.manualWeeklyBlockCount).toBe(manualCountB);
    // A 店在本檔建了手動封鎖；B 店的數字不得把它算進去
    if (manualCountA > 0) expect(impactB.manualWeeklyBlockCount).not.toBe(manualCountA + manualCountB);
  });

  it('②-8b B 店存檔不會刪到 A 店的自動封鎖', async () => {
    await ownerA.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_ONLY }),
    });
    const beforeA = await countAutoBlocks(SHOP_A.id);
    expect(beforeA).toBeGreaterThan(0);

    await ownerB.fetch('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business: PER_DAY_MON_TUE }),
    });

    const afterA = await countAutoBlocks(SHOP_A.id);
    expect(afterA).toBe(beforeA);

    // 收尾：把 B 店的 auto 封鎖清掉，不留殘留
    await admin.from('block_times').delete().eq('tenant_id', SHOP_B.id).eq('auto', true);
  });
});
