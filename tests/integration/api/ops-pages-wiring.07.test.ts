/**
 * 營運頁接線用到的端點 — issue #7（乙）前半六頁
 * -----------------------------------------------------------------------------
 * 這六頁（customers / block-times / points / staff / shifts / shop-design）接線前
 * 全是 `setTimeout` 假成功。本檔驗的是它們**現在真的會打到的那幾支端點**，
 * 每一條都以 service role 直查資料庫確認副作用真的發生（14 分冊 §1 A-1 的修法）。
 *
 * 已被別的檔案覆蓋、這裡不重複的：
 *   - POST/PUT/DELETE /api/customers → `customers.a3.test.ts`
 *   - POST/DELETE /api/block-times、available-slots → `bookings-advanced.b1.test.ts`
 *   - POST /api/shifts 批次 upsert → `staff-shifts.b2.test.ts`
 *   - PUT /api/settings 的 basic/shopCode/角色 → `settings.a1.test.ts`
 *
 * 本檔新增覆蓋：
 *   ① GET /api/block-times（block-times 頁的唯一資料源，先前沒有清單測試）
 *   ② PUT /api/block-times/:id（本次新增的端點：頁面的「編輯」按鈕）
 *   ③ POST /api/customers/:id/bind-line、unbind-line、GET /api/line-users/unbound
 *      （綁定 LINE：三支端點先前**零測試**）
 *   ④ PUT /api/settings 的 branding 群組（migration 0021，shop-design 頁）
 *   ⑤ PUT /api/settings 的 business.staffScheduleModes（shifts 頁的排班模式）
 *   ⑥ POST /api/points/topup/pay 回 501 + 客服文案（points 頁如實呈現的那句話）
 *
 * 清理紀律：自建的顧客 / line_users / block_times 一律在 afterAll 刪除；
 * tenant_settings 的 branding 與 business 測完還原成種子狀態（空 jsonb），
 * 否則 settings.a1 與 reports 系列的前提會被污染。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const DAY_MS = 24 * 60 * 60 * 1000;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

/** 本檔自建、afterAll 要清掉的東西 */
const createdCustomerIds: string[] = [];
const createdLineUserIds: string[] = [];
const createdBlockIds: string[] = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  if (createdBlockIds.length) {
    await admin.from('block_times').delete().in('id', createdBlockIds);
  }
  if (createdLineUserIds.length) {
    await admin.from('line_users').delete().in('line_user_id', createdLineUserIds);
  }
  if (createdCustomerIds.length) {
    await admin.from('customers').delete().in('id', createdCustomerIds);
  }
  // branding / business 還原成種子狀態（空 jsonb），不留給下一支測試檔
  await admin
    .from('tenant_settings')
    .update({ branding: {}, business: {} })
    .eq('tenant_id', SHOP_A.id);
});

/* ========================================================================== */
/* ① ② block-times：清單與編輯                                                 */
/* ========================================================================== */

describe('block-times 頁的資料源與編輯（04 §B-1）', () => {
  it('POST 後 GET /api/block-times 查得到剛建立的那筆（頁面重新整理仍在）', async () => {
    const start = new Date(Date.now() + 400 * DAY_MS);
    start.setUTCHours(2, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const reason = `整合測試封鎖-${uniqueSuffix()}`;

    const created = await ownerA.post('/api/block-times', {
      startAt: start.toISOString(), endAt: end.toISOString(), reason,
    });
    expect(created.status).toBe(200);
    const id = (await readJson<{ id: string }>(created)).data!.id;
    createdBlockIds.push(id);

    const list = await ownerA.get('/api/block-times');
    expect(list.status).toBe(200);
    const rows = (await readJson<{ id: string; reason: string; startAt: string; endAt: string; staffId: string | null }[]>(list)).data!;
    const mine = rows.find((r) => r.id === id);
    expect(mine, 'GET /api/block-times 應包含剛建立的那筆').toBeDefined();
    expect(mine!.reason).toBe(reason);
    expect(mine!.staffId).toBeNull(); // 省略 staffId = 全店封鎖
    expect(Date.parse(mine!.startAt)).toBe(start.getTime());
    expect(Date.parse(mine!.endAt)).toBe(end.getTime());
  });

  it('PUT /api/block-times/:id 改時間與名稱 → service role 直查資料庫是新值', async () => {
    const start = new Date(Date.now() + 401 * DAY_MS);
    start.setUTCHours(3, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const created = await ownerA.post('/api/block-times', {
      startAt: start.toISOString(), endAt: end.toISOString(), reason: '改之前',
    });
    const id = (await readJson<{ id: string }>(created)).data!.id;
    createdBlockIds.push(id);

    const newEnd = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const put = await ownerA.put(`/api/block-times/${id}`, {
      endAt: newEnd.toISOString(), reason: '改之後',
    });
    expect(put.status).toBe(200);

    const { data, error } = await admin
      .from('block_times').select('reason, start_at, end_at').eq('id', id).maybeSingle();
    expect(error).toBeNull();
    expect((data as any).reason).toBe('改之後');
    // 只送了 endAt/reason，start_at 不可被動到
    expect(Date.parse((data as any).start_at)).toBe(start.getTime());
    expect(Date.parse((data as any).end_at)).toBe(newEnd.getTime());
  });

  it('PUT 只送 endAt 且早於既有 startAt → 400 REQ_001，且資料庫沒被改到', async () => {
    const start = new Date(Date.now() + 402 * DAY_MS);
    start.setUTCHours(4, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const created = await ownerA.post('/api/block-times', {
      startAt: start.toISOString(), endAt: end.toISOString(), reason: '不可被改',
    });
    const id = (await readJson<{ id: string }>(created)).data!.id;
    createdBlockIds.push(id);

    const bad = new Date(start.getTime() - 60 * 60 * 1000);
    const put = await ownerA.put(`/api/block-times/${id}`, { endAt: bad.toISOString() });
    expect(put.status).toBe(400);
    expect((await readJson(put)).code).toBe('REQ_001');

    const { data } = await admin.from('block_times').select('end_at, reason').eq('id', id).maybeSingle();
    expect(Date.parse((data as any).end_at)).toBe(end.getTime());
    expect((data as any).reason).toBe('不可被改');
  });

  it('PUT 不存在的 id → 404 REQ_002', async () => {
    const put = await ownerA.put('/api/block-times/00000000-0000-0000-0000-000000000000', { reason: 'x' });
    expect(put.status).toBe(404);
    expect((await readJson(put)).code).toBe('REQ_002');
  });

  it('未登入 PUT → 401 AUTH_001', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/block-times/00000000-0000-0000-0000-000000000000`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

/* ========================================================================== */
/* ③ customers：LINE 綁定 / 解除綁定                                           */
/* ========================================================================== */

describe('顧客 LINE 綁定（04 §B-5.1）', () => {
  const lineUserId = `Utest${uniqueSuffix()}`;
  let customerId = '';

  beforeAll(async () => {
    const created = await ownerA.post('/api/customers', {
      name: `綁定測試顧客-${uniqueSuffix()}`, phone: `0900${Date.now() % 1000000}`,
    });
    expect(created.status).toBe(200);
    customerId = (await readJson<{ id: string }>(created)).data!.id;
    createdCustomerIds.push(customerId);

    const { error } = await admin.from('line_users').insert({
      tenant_id: SHOP_A.id,
      line_user_id: lineUserId,
      display_name: '整合測試好友',
      followed: true,
      customer_id: null,
    });
    expect(error).toBeNull();
    createdLineUserIds.push(lineUserId);
  });

  it('GET /api/line-users/unbound 含這位尚未綁定的好友（綁定 modal 的清單來源）', async () => {
    const res = await ownerA.get('/api/line-users/unbound');
    expect(res.status).toBe(200);
    const rows = (await readJson<{ lineUserId: string; displayName: string }[]>(res)).data!;
    const mine = rows.find((r) => r.lineUserId === lineUserId);
    expect(mine, '未綁定清單應含剛建立的 line_users 列').toBeDefined();
    expect(mine!.displayName).toBe('整合測試好友');
  });

  it('POST /api/customers/:id/bind-line → 兩張表都寫上（雙向），且該好友離開未綁定清單', async () => {
    const res = await ownerA.post(`/api/customers/${customerId}/bind-line`, { lineUserId });
    expect(res.status).toBe(200);

    const { data: cust } = await admin
      .from('customers').select('line_user_id').eq('id', customerId).maybeSingle();
    expect((cust as any).line_user_id).toBe(lineUserId);

    const { data: lu } = await admin
      .from('line_users').select('customer_id')
      .eq('tenant_id', SHOP_A.id).eq('line_user_id', lineUserId).maybeSingle();
    expect((lu as any).customer_id).toBe(customerId);

    const unbound = await ownerA.get('/api/line-users/unbound');
    const rows = (await readJson<{ lineUserId: string }[]>(unbound)).data!;
    expect(rows.some((r) => r.lineUserId === lineUserId)).toBe(false);
  });

  it('POST /api/customers/:id/unbind-line → 兩張表都清空（不是只清顧客那一側）', async () => {
    const res = await ownerA.post(`/api/customers/${customerId}/unbind-line`);
    expect(res.status).toBe(200);

    const { data: cust } = await admin
      .from('customers').select('line_user_id').eq('id', customerId).maybeSingle();
    expect((cust as any).line_user_id).toBeNull();

    const { data: lu } = await admin
      .from('line_users').select('customer_id')
      .eq('tenant_id', SHOP_A.id).eq('line_user_id', lineUserId).maybeSingle();
    expect((lu as any).customer_id).toBeNull();
  });

  it('bind-line 綁到不存在的 LINE 使用者 → 404 REQ_002，顧客那一側沒被改到', async () => {
    const res = await ownerA.post(`/api/customers/${customerId}/bind-line`, {
      lineUserId: 'Unot-exist-0000',
    });
    expect(res.status).toBe(404);
    expect((await readJson(res)).code).toBe('REQ_002');

    const { data: cust } = await admin
      .from('customers').select('line_user_id').eq('id', customerId).maybeSingle();
    expect((cust as any).line_user_id).toBeNull();
  });
});

/* ========================================================================== */
/* ④ ⑤ tenant_settings：branding 群組與排班模式                                */
/* ========================================================================== */

describe('shop-design 的 branding 群組（migration 0021）', () => {
  it('PUT /api/settings { branding } → service role 直查 tenant_settings.branding 是送出的值；GET 回讀相同', async () => {
    const branding = {
      shopName: `整合測試店名-${uniqueSuffix()}`,
      logoUrl: '',
      logoHidden: true,
      bannerUrl: '',
      bannerVideoUrl: '',
      bannerVideoSound: false,
      announcement: '本週三公休',
      aboutTitle: '關於我們',
      aboutContent: '整合測試內容',
      aboutImageUrl: '',
      gallery: [{ id: 'g_1', url: '', caption: '一號圖' }],
      themeColor: '#10b981',
      facebook: '',
      instagram: 'https://instagram.com/test',
      line: '',
      threads: '',
      googleMaps: '',
      contactEmail: 'test@example.com',
    };

    const put = await ownerA.put('/api/settings', { branding });
    expect(put.status).toBe(200);

    const { data, error } = await admin
      .from('tenant_settings').select('branding').eq('tenant_id', SHOP_A.id).maybeSingle();
    expect(error).toBeNull();
    expect((data as any).branding).toEqual(branding);

    const get = await ownerA.get('/api/settings');
    const settings = (await readJson<{ branding: typeof branding }>(get)).data!;
    expect(settings.branding).toEqual(branding);
  });

  it('只送 branding 不會動到 basic（群組彼此獨立，這是 shop-design 與 settings 兩頁不互相洗掉的前提）', async () => {
    const before = await ownerA.get('/api/settings');
    const basicBefore = (await readJson<{ basic: Record<string, unknown> }>(before)).data!.basic;

    const put = await ownerA.put('/api/settings', { branding: { announcement: '只改公告' } });
    expect(put.status).toBe(200);

    const after = await ownerA.get('/api/settings');
    const body = (await readJson<{ basic: Record<string, unknown>; branding: { announcement: string } }>(after)).data!;
    expect(body.basic).toEqual(basicBefore);
    expect(body.branding.announcement).toBe('只改公告');
  });
});

describe('shifts 的排班模式（business.staffScheduleModes）', () => {
  it('PUT /api/settings { business } → 直查 business jsonb 含 staffScheduleModes；GET 回讀相同', async () => {
    const get0 = await ownerA.get('/api/settings');
    const business = (await readJson<{ business: Record<string, unknown> }>(get0)).data!.business;

    const staffId = '11111111-2222-3333-4444-555555555555';
    const next = { ...business, staffScheduleModes: { [staffId]: 'FIXED_REST' } };

    const put = await ownerA.put('/api/settings', { business: next });
    expect(put.status).toBe(200);

    const { data } = await admin
      .from('tenant_settings').select('business').eq('tenant_id', SHOP_A.id).maybeSingle();
    expect((data as any).business.staffScheduleModes).toEqual({ [staffId]: 'FIXED_REST' });

    const get1 = await ownerA.get('/api/settings');
    const after = (await readJson<{ business: { staffScheduleModes: Record<string, string> } }>(get1)).data!;
    expect(after.business.staffScheduleModes).toEqual({ [staffId]: 'FIXED_REST' });
  });

  it('模式以外的 business 欄位不因為多了這個鍵而被洗掉（整包覆蓋的前提）', async () => {
    const get0 = await ownerA.get('/api/settings');
    const business = (await readJson<{ business: Record<string, unknown> }>(get0)).data!.business;

    const next = { ...business, slotInterval: 60, staffScheduleModes: { a: 'ROTATING' } };
    const put = await ownerA.put('/api/settings', { business: next });
    expect(put.status).toBe(200);

    const get1 = await ownerA.get('/api/settings');
    const after = (await readJson<{ business: Record<string, unknown> }>(get1)).data!.business;
    expect(after.slotInterval).toBe(60);
    expect(after.staffScheduleModes).toEqual({ a: 'ROTATING' });
  });
});

describe('staff 的自訂稱呼（basic.staffTerm）', () => {
  it('PUT /api/settings { basic } 帶 staffTerm → 直查 tenant_settings.basic.staffTerm 是新值', async () => {
    const get0 = await ownerA.get('/api/settings');
    const basic = (await readJson<{ basic: Record<string, unknown> }>(get0)).data!.basic;

    const term = `設計師-${uniqueSuffix()}`;
    const put = await ownerA.put('/api/settings', { basic: { ...basic, staffTerm: term } });
    expect(put.status).toBe(200);

    const { data } = await admin
      .from('tenant_settings').select('basic').eq('tenant_id', SHOP_A.id).maybeSingle();
    expect((data as any).basic.staffTerm).toBe(term);

    const get1 = await ownerA.get('/api/settings');
    expect((await readJson<{ basic: { staffTerm: string } }>(get1)).data!.basic.staffTerm).toBe(term);

    // 還原，不污染 settings.a1 的 basic 斷言
    await ownerA.put('/api/settings', { basic });
  });
});

describe('shifts 週班表：頁面的「先清區間再寫入」兩步驟真的落庫', () => {
  it('repeat-cycle 七天全 null 清空 → POST /api/shifts 寫入上班日 → 直查 shifts 只剩新排的那幾天', async () => {
    const staffId = SHOP_A.staffA1;
    // 未來很遠的一整週（週日起算七天），避開 seed 與其他測試檔
    const start = new Date(Date.now() + 500 * DAY_MS);
    while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() + 1);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY_MS);
      return d.toISOString().slice(0, 10);
    });
    const from = days[0];
    const to = days[6];

    // 先放一筆「舊班」，證明第一步真的會把它清掉（頁面不先清的話會留殘班）
    const seeded = await ownerA.post('/api/shifts', [
      { staffId, workDate: days[1], startTime: '08:00', endTime: '09:00' },
    ]);
    expect(seeded.status).toBe(200);

    // ① 清空整個區間（頁面的第一步）
    const cleared = await ownerA.post('/api/shifts/repeat-cycle', {
      staffId,
      weekPattern: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
      from, to,
    });
    expect(cleared.status).toBe(200);

    // ② 依週表寫入「週一到週五 10:00–20:00」（頁面的第二步）
    const workingDays = days.filter((d) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5;
    });
    const wrote = await ownerA.post('/api/shifts', workingDays.map((workDate) => ({
      staffId, workDate, startTime: '10:00', endTime: '20:00',
    })));
    expect(wrote.status).toBe(200);

    const { data, error } = await admin
      .from('shifts')
      .select('work_date, start_time, end_time')
      .eq('tenant_id', SHOP_A.id)
      .eq('staff_id', staffId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true });
    expect(error).toBeNull();

    expect((data ?? []).map((r: any) => r.work_date)).toEqual(workingDays);
    for (const r of data ?? []) {
      expect(String((r as any).start_time).slice(0, 5)).toBe('10:00');
      expect(String((r as any).end_time).slice(0, 5)).toBe('20:00');
    }
    // 08:00 那筆舊班已經被第一步清掉（不是被 upsert 留下來變成同日兩筆）
    expect((data ?? []).filter((r: any) => String(r.start_time).startsWith('08')).length).toBe(0);

    // 清乾淨
    await admin.from('shifts').delete()
      .eq('tenant_id', SHOP_A.id).eq('staff_id', staffId).gte('work_date', from).lte('work_date', to);
  });
});

/* ========================================================================== */
/* ⑥ points 儲值：規格內的誠實 501                                             */
/* ========================================================================== */

describe('POST /api/points/topup/pay（09 §4：MVP 不接金流）', () => {
  it('回 501 且訊息是客服提示 —— 頁面要如實顯示這句話，不是顯示成功', async () => {
    const res = await ownerA.post('/api/points/topup/pay', { amount: 1000 });
    expect(res.status).toBe(501);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.message).toBe('請聯絡平台客服儲值');
  });

  it('沒有任何點數交易被寫進去（501 = 什麼都沒發生，不是「處理中」）', async () => {
    const { count, error } = await admin
      .from('tenant_point_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id)
      .eq('type', 'TOPUP');
    expect(error).toBeNull();
    const before = count ?? 0;

    const res = await ownerA.post('/api/points/topup/pay', { amount: 5000 });
    expect(res.status).toBe(501);

    const { count: after } = await admin
      .from('tenant_point_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id)
      .eq('type', 'TOPUP');
    expect(after ?? 0).toBe(before);
  });

  it('未登入 → 401 AUTH_001（501 不是「誰都可以打」的意思）', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/points/topup/pay`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
