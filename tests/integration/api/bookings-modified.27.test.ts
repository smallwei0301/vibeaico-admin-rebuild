/**
 * PUT /api/bookings/:id 的顧客端「預約已變更」推播 — issue #27 ②
 * -----------------------------------------------------------------------------
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §5（notify 觸發點、開關對應、
 * fire-and-forget 規約）、docs/integration/04-API-CONTRACTS.md §B-1
 * （`PUT /api/bookings/:id`）。實作：src/app/api/bookings/[id]/route.ts、
 * src/server/line-notify.ts。
 *
 * 修好前的病：`notifyBookingStatus` 的五個 kind 只有 MODIFIED 全站沒有任何呼叫端，
 * 端點只 update 四個欄位、連 import 都沒有；頁面卻寫死「預約已更新，已發送通知給
 * 顧客」。顧客的預約時間被改了，什麼都收不到。
 *
 * 本檔驗四條路徑（都打真端點、看真 mock LINE 收到什麼、真查 push_quota_usage）：
 *   1. notifyBookingModified 開 + 改時間 → mock 收到 push、額度 -1
 *   2. 同上但只改備註 → 零 push、額度不變（決策：備註是店家內部註記，不推播）
 *   3. notifyBookingModified 關 + 改時間 → 零 push、額度不變、API 仍 200
 *   4. 額度用盡 + 改時間 → 零 push、額度不變、API 仍 200
 *
 * 鏈路（同 line-webhook.06）：本測試 process 在固定 port 4123 起假 LINE server；
 * global-setup 起的 next dev 讀 .env.test 的 LINE_API_BASE 打到這裡。
 *
 * 清理紀律：本檔自建顧客/服務/預約（不動 seed 的 customerA1/A2/A3 與四筆預約——
 * reports.a5 手算期望值依賴它們），afterAll 依 FK 方向刪回去；tenant_settings
 * （notify + LINE 憑證欄）與 push_quota_usage 當月列都先快照後還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const PUSH_PATH = '/v2/bot/message/push';

/** 本檔專用測試憑證與 LINE user id（避免與其他測試檔互踩） */
const CHANNEL_SECRET = 'itest-line-secret-27-booking';
const CHANNEL_TOKEN = 'itest-line-token-27-booking';
const LINE_USER = 'Ubk27itest00000000000000000000001';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let customerId: string;
let serviceId: string;
let staffId: string;
let bookingId: string;

/** 快照（afterAll 還原） */
let settingsSnapshot: { notify: unknown; line_channel_secret_enc: string; line_channel_access_token_enc: string } | null = null;
let quotaSnapshot: number | null = null;   // null = 本檔開始時當月沒有這一列

async function quotaUsed(): Promise<number> {
  const { data } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

/** 只改 notify 這一欄（保留 tenant_settings 其他欄位） */
async function setNotify(patch: Record<string, unknown>): Promise<void> {
  const { data } = await admin.from('tenant_settings').select('notify')
    .eq('tenant_id', SHOP_A.id).single();
  const merged = { ...((data?.notify as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await admin.from('tenant_settings').update({ notify: merged })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

/** 目前預約的時間/員工/備註（驗 update 真的寫進去了） */
async function bookingRow(): Promise<{ start_at: string; staff_id: string | null; note: string }> {
  const { data, error } = await admin.from('bookings')
    .select('start_at, staff_id, note').eq('id', bookingId).single();
  expect(error).toBeNull();
  return data as any;
}

/** 未來第 n 小時的整點 ISO（避開 x_bookings_overlap 與 seed 的四筆預約） */
function futureIso(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 ' +
      'LINE_API_BASE=http://localhost:4123 與 LINE_DATA_API_BASE=http://localhost:4123，' +
      '讓 next dev 的 src/server/line.ts 打到 tests/helpers/line-mock.ts 起的假 LINE。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await mock.start();

  // ---- tenant_settings 快照 + 寫入測試 LINE 憑證 ----
  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('notify, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // ---- push_quota_usage 當月基線快照 ----
  const { data: q } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  quotaSnapshot = (q as { used: number } | null)?.used ?? null;

  // ---- 本檔自建的顧客（已綁 LINE）／服務／員工／預約 ----
  customerId = randomUUID();
  serviceId = randomUUID();
  staffId = randomUUID();
  bookingId = randomUUID();

  const { error: e2 } = await admin.from('customers').insert({
    id: customerId, tenant_id: SHOP_A.id, name: '#27② 變更通知測試顧客',
    phone: '0900270002', line_user_id: LINE_USER,
  });
  expect(e2).toBeNull();
  const { error: e3 } = await admin.from('services').insert({
    id: serviceId, tenant_id: SHOP_A.id, name: '#27② 測試服務', duration_minutes: 60, price: 500,
  });
  expect(e3).toBeNull();
  const { error: e4 } = await admin.from('staff').insert({
    id: staffId, tenant_id: SHOP_A.id, name: '#27② 測試員工',
  });
  expect(e4).toBeNull();
  const start = futureIso(240);
  const { error: e5 } = await admin.from('bookings').insert({
    id: bookingId, tenant_id: SHOP_A.id, customer_id: customerId, service_id: serviceId,
    staff_id: null, booking_no: 'B27MOD001', status: 'CONFIRMED', payment_status: 'UNPAID',
    duration_minutes: 60, price: 500, final_price: 500, source: 'MANUAL',
    start_at: start, end_at: new Date(Date.parse(start) + 3_600_000).toISOString(), note: '',
  });
  expect(e5).toBeNull();
});

afterAll(async () => {
  await admin.from('bookings').delete().eq('id', bookingId);
  await admin.from('staff').delete().eq('id', staffId);
  await admin.from('services').delete().eq('id', serviceId);
  await admin.from('customers').delete().eq('id', customerId);

  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      notify: settingsSnapshot.notify,
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  if (quotaSnapshot === null) {
    await admin.from('push_quota_usage').delete()
      .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey());
  } else {
    await admin.from('push_quota_usage')
      .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaSnapshot });
  }
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

/**
 * 推播是 fire-and-forget（06 §5：端點 `void notifyBookingStatus(...)` 不 await），
 * 所以 API 回 200 的當下 push 可能還沒送達 mock。輪詢等它（間隔 100ms、上限 5s，
 * 12 §2.3「禁用 sleep 等待：輪詢條件」）。
 */
async function waitForPushes(count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.requestsFor(PUSH_PATH).length >= count) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `等不到 ${count} 則 push（實際 ${mock.requestsFor(PUSH_PATH).length} 則）。` +
    `收到的路徑：${mock.requests.map((r) => r.path).join(', ') || '（無）'}`,
  );
}

/**
 * 驗「沒有推播」：fire-and-forget 沒有可等的訊號，等一小段時間確認它**沒有**發生。
 * 用同一個輪詢上限的 1/5（1s）——這段時間內同機的 localhost push 若會發生早就到了
 * （對照組案例證明了正常情況遠快於此）。
 */
async function expectNoPush(): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    expect(mock.requestsFor(PUSH_PATH)).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('PUT /api/bookings/:id — MODIFIED 顧客端推播（06 §5）', () => {
  it('notifyBookingModified 開 + 改時間 → mock LINE 收到「預約已變更」push，額度 -1', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);

    const newStart = futureIso(268);
    const res = await ownerA.put(`/api/bookings/${bookingId}`, { startAt: newStart, note: '' });
    expect(res.status).toBe(200);
    const body = await readJson<{ notifyTriggered: boolean }>(res);
    expect(body.success).toBe(true);
    expect(body.data?.notifyTriggered).toBe(true);

    await waitForPushes(1);
    const push = mock.requestsFor(PUSH_PATH)[0];
    expect(push.body.to).toBe(LINE_USER);
    const text = String(push.body.messages[0].text);
    expect(text).toContain('您的預約內容已變更');   // line-notify.ts COPY.MODIFIED.title
    expect(text).toContain('#27② 測試服務');
    expect(push.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);

    // 時間真的改了，且額度扣了 1
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
    expect(await quotaUsed()).toBe(1);
  });

  it('只改備註（時間/員工不動）→ notifyTriggered=false、零 push、額度不變', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);
    const before = await bookingRow();

    const res = await ownerA.put(`/api/bookings/${bookingId}`, {
      startAt: before.start_at,                 // 原值原樣送回（頁面每次都會帶齊三個欄位）
      staffId: before.staff_id,
      note: '#27② 只改備註',
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ notifyTriggered: boolean }>(res);
    expect(body.data?.notifyTriggered).toBe(false);

    await expectNoPush();
    expect(await quotaUsed()).toBe(0);
    // 備註確實寫進去了（沒推播 ≠ 沒存檔）
    expect((await bookingRow()).note).toBe('#27② 只改備註');
  });

  it('改服務人員（時間不動）→ 有推播：人員也是顧客該知道的變更', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);
    const before = await bookingRow();

    const res = await ownerA.put(`/api/bookings/${bookingId}`, {
      startAt: before.start_at, staffId, note: '#27② 只改備註',
    });
    expect(res.status).toBe(200);
    expect((await readJson<{ notifyTriggered: boolean }>(res)).data?.notifyTriggered).toBe(true);

    await waitForPushes(1);
    expect(await quotaUsed()).toBe(1);
    expect((await bookingRow()).staff_id).toBe(staffId);
  });

  it('notifyBookingModified 關 + 改時間 → API 仍 200，但零 push、額度不變', async () => {
    await setNotify({ notifyBookingModified: false });
    await setQuotaUsed(0);

    const newStart = futureIso(292);
    const res = await ownerA.put(`/api/bookings/${bookingId}`, { startAt: newStart });
    expect(res.status).toBe(200);

    await expectNoPush();
    expect(await quotaUsed()).toBe(0);
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
  });

  it('推播額度用盡 + 改時間 → 不打 LINE，但 API 仍成功、預約仍改成功（12 §4 Phase 6 樣板）', async () => {
    await setNotify({ notifyBookingModified: true });
    // SHOP_A 種子含 EXTRA_PUSH → 上限 700（09 分冊 §5）；填滿它
    await setQuotaUsed(700);

    const newStart = futureIso(316);
    const res = await ownerA.put(`/api/bookings/${bookingId}`, { startAt: newStart });
    expect(res.status).toBe(200);

    await expectNoPush();
    expect(await quotaUsed()).toBe(700);        // 沒送出就不該扣
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
  });
});
