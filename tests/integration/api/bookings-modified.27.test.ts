/**
 * PUT /api/bookings/:id 的顧客端「預約已變更」推播 — Issue #27②
 *
 * 本檔打真 API、看真 mock LINE 請求、查真 push_quota_usage，驗五條路徑：
 * 1. 通知開啟 + 改時間 → push 1 則、額度 +1
 * 2. 只改店內備註 → 不通知，但備註真的保存
 * 3. 只改服務人員 → push 1 則、額度 +1
 * 4. 通知關閉 + 改時間 → API 仍成功、零 push
 * 5. 額度用盡 + 改時間 → API 仍成功、零 push
 *
 * 測試服務透過 POST /api/services 建立，讓 current-main 的原子雙排序器自行配置
 * sort_order / line_sort_order，不再用舊式直接 insert 預設 0 重演 Issue #128。
 * 所有測試資料與設定都有 fail-closed cleanup，任何清理錯誤或殘留都會讓本檔轉紅。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const PUSH_PATH = '/v2/bot/message/push';
const CHANNEL_SECRET = 'itest-line-secret-27-booking';
const CHANNEL_TOKEN = 'itest-line-token-27-booking';
const LINE_USER = 'Ubk27itest00000000000000000000001';

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
};

type SettingsSnapshot = {
  notify: Record<string, unknown> | null;
  line_channel_secret_enc: string | null;
  line_channel_access_token_enc: string | null;
};

const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient | null = null;
let ownerA: AuthedApi;
const mock = new LineMockServer();
let mockStarted = false;

let customerId = '';
let serviceId = '';
let staffId = '';
let bookingId = '';
let baseFutureHours = 240;
let settingsSnapshot: SettingsSnapshot | null = null;
let quotaSnapshot: number | null = null;

function database(): SupabaseClient {
  if (!admin) throw new Error('TEST Supabase 尚未初始化');
  return admin;
}

async function quotaUsed(): Promise<number> {
  const { data, error } = await database()
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await database()
    .from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

async function setNotify(patch: Record<string, unknown>): Promise<void> {
  const { data, error: readError } = await database()
    .from('tenant_settings')
    .select('notify')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(readError).toBeNull();

  const merged = { ...((data?.notify as Record<string, unknown>) ?? {}), ...patch };
  const { error: writeError } = await database()
    .from('tenant_settings')
    .update({ notify: merged })
    .eq('tenant_id', SHOP_A.id);
  expect(writeError).toBeNull();
}

async function bookingRow(): Promise<{
  start_at: string;
  staff_id: string | null;
  note: string;
}> {
  const { data, error } = await database()
    .from('bookings')
    .select('start_at, staff_id, note')
    .eq('id', bookingId)
    .single();
  expect(error).toBeNull();
  return data as { start_at: string; staff_id: string | null; note: string };
}

function futureIso(hoursFromBase: number): string {
  const d = new Date(Date.now() + (baseFutureHours + hoursFromBase) * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 LINE_API_BASE=http://localhost:4123，' +
        '讓 next dev 的 LINE 請求打到測試用 mock server。',
    );
  }

  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await mock.start();
  mockStarted = true;

  const db = database();
  const { data: snap, error: snapshotError } = await db
    .from('tenant_settings')
    .select('notify, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(snapshotError).toBeNull();
  settingsSnapshot = snap as SettingsSnapshot;

  const { error: credentialError } = await db
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    })
    .eq('tenant_id', SHOP_A.id);
  expect(credentialError).toBeNull();

  const { data: quota, error: quotaError } = await db
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(quotaError).toBeNull();
  quotaSnapshot = (quota as { used: number } | null)?.used ?? null;

  const suffix = uniqueSuffix();
  customerId = randomUUID();
  staffId = randomUUID();
  bookingId = randomUUID();
  baseFutureHours = 240 + Math.floor(Math.random() * 240);

  const { error: customerError } = await db.from('customers').insert({
    id: customerId,
    tenant_id: SHOP_A.id,
    name: `#27② 變更通知測試顧客-${suffix}`,
    phone: `09${String(Date.now()).slice(-8)}`,
    line_user_id: LINE_USER,
  });
  expect(customerError).toBeNull();

  const serviceResponse = await ownerA.post('/api/services', {
    name: `#27② 測試服務-${suffix}`,
    durationMinutes: 60,
    price: 500,
    active: true,
    lineFeatured: false,
  });
  expect(serviceResponse.status).toBe(200);
  const serviceBody = await readJson<{
    id: string;
    sortOrder: number;
    lineSortOrder: number;
  }>(serviceResponse);
  expect(serviceBody.success).toBe(true);
  expect(serviceBody.data?.id).toBeTruthy();
  expect(Number.isInteger(serviceBody.data?.sortOrder)).toBe(true);
  expect(Number.isInteger(serviceBody.data?.lineSortOrder)).toBe(true);
  serviceId = serviceBody.data!.id;

  const { data: lastStaff, error: staffRankError } = await db
    .from('staff')
    .select('sort_order')
    .eq('tenant_id', SHOP_A.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(staffRankError).toBeNull();
  const staffSortOrder = Number((lastStaff as { sort_order?: number } | null)?.sort_order ?? 0) + 1_000;

  const { error: staffError } = await db.from('staff').insert({
    id: staffId,
    tenant_id: SHOP_A.id,
    name: `#27② 測試員工-${suffix}`,
    active: true,
    bookable: true,
    sort_order: staffSortOrder,
  });
  expect(staffError).toBeNull();

  const start = futureIso(0);
  const bookingNo = `B27M${suffix.slice(0, 12).toUpperCase()}`;
  const { error: bookingError } = await db.from('bookings').insert({
    id: bookingId,
    tenant_id: SHOP_A.id,
    customer_id: customerId,
    service_id: serviceId,
    staff_id: null,
    booking_no: bookingNo,
    status: 'CONFIRMED',
    payment_status: 'UNPAID',
    duration_minutes: 60,
    price: 500,
    final_price: 500,
    source: 'MANUAL',
    start_at: start,
    end_at: new Date(Date.parse(start) + 3_600_000).toISOString(),
    note: '',
  });
  expect(bookingError).toBeNull();
});

afterAll(async () => {
  const failures: string[] = [];
  const db = admin;

  const recordMutation = async (label: string, operation: any) => {
    const { error } = await operation;
    if (error) failures.push(`${label}: ${error.message}`);
  };

  if (db) {
    if (bookingId) {
      await recordMutation('delete booking', db.from('bookings').delete().eq('id', bookingId));
    }
    if (staffId) {
      await recordMutation('delete staff', db.from('staff').delete().eq('id', staffId));
    }
    if (serviceId) {
      await recordMutation('delete service', db.from('services').delete().eq('id', serviceId));
    }
    if (customerId) {
      await recordMutation('delete customer', db.from('customers').delete().eq('id', customerId));
    }

    if (settingsSnapshot) {
      await recordMutation(
        'restore tenant settings',
        db
          .from('tenant_settings')
          .update({
            notify: settingsSnapshot.notify,
            line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
            line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
          })
          .eq('tenant_id', SHOP_A.id),
      );
    }

    if (quotaSnapshot === null) {
      await recordMutation(
        'remove test quota row',
        db
          .from('push_quota_usage')
          .delete()
          .eq('tenant_id', SHOP_A.id)
          .eq('month', taipeiMonthKey()),
      );
    } else {
      await recordMutation(
        'restore quota row',
        db
          .from('push_quota_usage')
          .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaSnapshot }),
      );
    }

    for (const [table, id] of [
      ['bookings', bookingId],
      ['staff', staffId],
      ['services', serviceId],
      ['customers', customerId],
    ] as const) {
      if (!id) continue;
      const { count, error } = await db
        .from(table)
        .select('id', { head: true, count: 'exact' })
        .eq('id', id);
      if (error) failures.push(`verify ${table} cleanup: ${error.message}`);
      else if (count !== 0) failures.push(`verify ${table} cleanup: expected 0, got ${count}`);
    }
  }

  if (mockStarted) {
    try {
      await mock.stop();
    } catch (error) {
      failures.push(`stop LINE mock: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  expect(failures).toEqual([]);
});

beforeEach(() => {
  mock.reset();
});

async function waitForPushes(count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.requestsFor(PUSH_PATH).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `等不到 ${count} 則 push（實際 ${mock.requestsFor(PUSH_PATH).length} 則）。` +
      `收到的路徑：${mock.requests.map((request) => request.path).join(', ') || '（無）'}`,
  );
}

async function expectNoPush(): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    expect(mock.requestsFor(PUSH_PATH)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('PUT /api/bookings/:id — MODIFIED 顧客通知', () => {
  it('notifyBookingModified 開啟且改時間 → LINE push 一則、額度加一', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);

    const newStart = futureIso(24);
    const response = await ownerA.put(`/api/bookings/${bookingId}`, {
      startAt: newStart,
      note: '',
    });
    expect(response.status).toBe(200);
    const body = await readJson<{ notifyTriggered: boolean }>(response);
    expect(body.success).toBe(true);
    expect(body.data?.notifyTriggered).toBe(true);

    await waitForPushes(1);
    const push = mock.requestsFor(PUSH_PATH)[0];
    expect(push.body.to).toBe(LINE_USER);
    expect(String(push.body.messages[0].text)).toContain('您的預約內容已變更');
    expect(String(push.body.messages[0].text)).toContain('#27② 測試服務');
    expect(push.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
    expect(await quotaUsed()).toBe(1);
  });

  it('只改店內備註 → notifyTriggered=false、零 push、備註仍保存', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);
    const before = await bookingRow();

    const response = await ownerA.put(`/api/bookings/${bookingId}`, {
      startAt: before.start_at,
      staffId: before.staff_id,
      note: '#27② 只改備註',
    });
    expect(response.status).toBe(200);
    expect((await readJson<{ notifyTriggered: boolean }>(response)).data?.notifyTriggered).toBe(false);

    await expectNoPush();
    expect(await quotaUsed()).toBe(0);
    expect((await bookingRow()).note).toBe('#27② 只改備註');
  });

  it('只改服務人員 → LINE push 一則、額度加一', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(0);
    const before = await bookingRow();

    const response = await ownerA.put(`/api/bookings/${bookingId}`, {
      startAt: before.start_at,
      staffId,
      note: before.note,
    });
    expect(response.status).toBe(200);
    expect((await readJson<{ notifyTriggered: boolean }>(response)).data?.notifyTriggered).toBe(true);

    await waitForPushes(1);
    expect(await quotaUsed()).toBe(1);
    expect((await bookingRow()).staff_id).toBe(staffId);
  });

  it('notifyBookingModified 關閉且改時間 → API 成功、零 push、額度不變', async () => {
    await setNotify({ notifyBookingModified: false });
    await setQuotaUsed(0);

    const newStart = futureIso(48);
    const response = await ownerA.put(`/api/bookings/${bookingId}`, { startAt: newStart });
    expect(response.status).toBe(200);

    await expectNoPush();
    expect(await quotaUsed()).toBe(0);
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
  });

  it('推播額度用盡且改時間 → 不打 LINE，但 API 與預約更新仍成功', async () => {
    await setNotify({ notifyBookingModified: true });
    await setQuotaUsed(999_999);

    const newStart = futureIso(72);
    const response = await ownerA.put(`/api/bookings/${bookingId}`, { startAt: newStart });
    expect(response.status).toBe(200);

    await expectNoPush();
    expect(await quotaUsed()).toBe(999_999);
    expect(Date.parse((await bookingRow()).start_at)).toBe(Date.parse(newStart));
  });
});
