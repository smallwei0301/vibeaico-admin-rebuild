/**
 * 預約狀態變更的顧客端 LINE 推播（line-notify 路徑）整合測試
 * -----------------------------------------------------------------------------
 * 12 分冊 §4「Phase 6（LINE）」2026-08-24 補列第三組：
 *   「預約狀態推播（line-notify 路徑）：confirm/cancel/complete/no-show 各 route
 *    觸發後 mock LINE 收到 push、額度 -1；額度用盡時不呼叫 LINE 且 API 本身仍成功。」
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §5（觸發點、開關對應、
 * fire-and-forget 規約、額度控管）。實作：src/server/line-notify.ts、
 * src/app/api/bookings/[id]/{confirm,cancel,complete,no-show}/route.ts。
 *
 * MODIFIED 那一個 kind 已由 tests/integration/api/bookings-modified.27.test.ts
 * 覆蓋（issue #27 ②）；本檔補的是原矩陣漏掉的其餘四個動作端點。
 *
 * ⚠️「額度用盡」那兩條的斷言是 **`mock.requests` 整個為空**，不是「/push 沒被
 * 呼叫」。這是本專案既有慣例（見 chat-link.06 對 SILENT 分支的處理）：斷言
 * 某一支端點沒被打，擋不住「改成打了別支」——例如有人把 push 換成 multicast
 * 或 narrowcast，只看 /push 的測試照樣綠。
 *
 * 等待紀律（fire-and-forget，沒有 webhook 那種 server 端排空端點可用）：
 *   - 正向：輪詢等 push 抵達 mock（間隔 100ms、上限 5s，12 §2.3 允許的輪詢，
 *     禁止的是 `await sleep(n)` 之後直接斷言）。
 *   - 反向：**用障壁（barrier），不用固定秒數**。作法是在 **SHOP_B**（獨立的
 *     推播額度列、獨立的 notify 設定、獨立的 LINE 憑證）觸發一則一定會推的通知，
 *     等它抵達 mock，再斷言 mock 收到的請求「只有障壁那一則」。
 *
 *     為什麼不沿用既有的「1 秒內持續斷言為零」（bookings-modified.27）：
 *     本檔寫作時做的變異測試證明那個窗口太短——把 `line-notify.ts` 的額度閘門
 *     拿掉之後，本該轉紅的「confirm：額度填滿」**沒有紅**，那則被錯誤送出的 push
 *     是在 1 秒之後才抵達，於是它汙染了**後面兩個**案例、由它們去紅。也就是說
 *     那種寫法的紅燈會落在錯的案例上，而在只有一個負向案例時會直接假綠。
 *     notifyBookingStatus 一趟要打 5~6 次遠端 Supabase 往返，超過 1 秒很正常。
 *
 *     障壁為什麼成立：兩條通知走**同一支** notifyBookingStatus、同一組 DB 往返；
 *     受測的那一次比障壁那一次**更早**發動（障壁的 HTTP 請求要等前一個回應完才送出），
 *     所以障壁的 push 抵達時，受測那次若有 push 早就該到了。兩次觸發之間**沒有任何
 *     DB 寫入**（額度用不同租戶隔開，不是靠改數字），所以也沒有「改到一半被讀走」
 *     的競態。
 *
 * 鏈路：本測試 process 在固定 port 4123 起假 LINE server；global-setup spawn 的
 * next dev 讀 .env.test 的 LINE_API_BASE 打到這裡。
 *
 * 清理紀律：本檔自建 A 店與 B 店各自的顧客／服務／員工／預約（不動 seed 的四筆
 * 預約與三位顧客——reports.a5 與 reports-advanced.b6 的手算期望值依賴它們），
 * afterAll 依 FK 方向刪回去；兩店的 tenant_settings（notify + 兩個 *_enc）與
 * push_quota_usage 當月列先快照後還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const PUSH_PATH = '/v2/bot/message/push';

const CHANNEL_SECRET = 'itest-line-secret-07-notify';
const CHANNEL_TOKEN = 'itest-line-token-07-notify';
const LINE_USER = 'Unotify07itest000000000000000001';

/** 障壁用的 B 店憑證與顧客（額度、設定、憑證都與 A 店各自獨立） */
const CHANNEL_SECRET_B = 'itest-line-secret-07-notify-b';
const CHANNEL_TOKEN_B = 'itest-line-token-07-notify-b';
const LINE_USER_B = 'Unotify07itestbarrier00000000001';

/** SHOP_A 的種子含 EXTRA_PUSH 訂閱 → 推播上限 700（09 分冊 §5、src/server/line.ts） */
const QUOTA_LIMIT = 700;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 未來第 n 小時的整點 ISO（避開 seed 的四筆預約與其他測試檔的時段） */
function futureIso(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();

let customerId: string;
let serviceId: string;
let staffId: string;
let customerIdB: string;
let serviceIdB: string;

/** 每個案例一筆專屬預約（動作端點都是一次性的狀態轉移，不能共用） */
const bookings: Record<string, string> = {};
/** 障壁用的 B 店預約，一個負向案例一筆 */
const barrierBookings: Record<string, string> = {};

type SettingsSnapshot = {
  notify: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
};
const settingsSnapshot: Record<string, SettingsSnapshot | null> = {};
const quotaSnapshot: Record<string, number | null> = {};

async function quotaUsed(tenantId: string = SHOP_A.id): Promise<number> {
  const { data } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', tenantId).eq('month', taipeiMonthKey()).maybeSingle();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number, tenantId: string = SHOP_A.id): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: tenantId, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

async function setNotify(patch: Record<string, unknown>, tenantId: string = SHOP_A.id): Promise<void> {
  const { data } = await admin.from('tenant_settings').select('notify')
    .eq('tenant_id', tenantId).single();
  const merged = { ...((data?.notify as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await admin.from('tenant_settings').update({ notify: merged })
    .eq('tenant_id', tenantId);
  expect(error).toBeNull();
}

/** 四個推播開關全開（三個預設是關的，不開的話推播根本不會發生） */
async function enableAllStatusNotifications(): Promise<void> {
  await setNotify({
    notifyBookingConfirmed: true,
    notifyBookingCancelled: true,
    notifyBookingCompleted: true,
    notifyBookingNoShow: true,
  });
}

async function bookingStatus(id: string): Promise<string> {
  const { data, error } = await admin.from('bookings').select('status').eq('id', id).single();
  expect(error).toBeNull();
  return data!.status as string;
}

/**
 * 等到 mock LINE 收到 `count` 則 push（fire-and-forget 沒有可等的完成訊號，
 * 用輪詢；12 §2.3 禁的是 sleep 後直接斷言，輪詢條件是允許的）。
 */
async function waitForPushes(count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.requestsFor(PUSH_PATH).length >= count) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `等不到 ${count} 則 push（實際 ${mock.requestsFor(PUSH_PATH).length} 則）。` +
    `mock 收到的路徑：${mock.requests.map((r) => `${r.method} ${r.path}`).join(', ') || '（無）'}`,
  );
}

/** 輪詢等某個條件成立（12 §2.3 允許的輪詢；逾時＝紅燈，不會假綠） */
async function waitUntil(cond: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `等不到「${label}」。mock 收到的請求：` +
    `${mock.requests.map((r) => `${r.method} ${r.path}→${r.body?.to ?? ''}`).join(', ') || '（無）'}`,
  );
}

/**
 * 驗「A 店這次動作完全沒有打過 LINE」——**整個 mock.requests 只有障壁那一則**。
 *
 * 障壁 = 在 B 店（獨立額度／設定／憑證）觸發一則必定會推的通知。等它抵達之後，
 * A 店那一次若有請求早就到了（見檔頭「障壁為什麼成立」）。不用固定秒數猜等。
 */
async function expectNoLineRequestExceptBarrier(barrierKey: string): Promise<void> {
  const res = await ownerB.post(`/api/bookings/${barrierBookings[barrierKey]}/confirm`);
  expect(res.status).toBe(200);

  await waitUntil(
    () => mock.requestsFor(PUSH_PATH).some((r) => r.body?.to === LINE_USER_B),
    '障壁：B 店的 push 抵達 mock',
  );

  // 障壁那一則之外，一個請求都不該有（不是只看 /push——換成 multicast 也要抓到）
  expect(mock.requests.map((r) => `${r.method} ${r.path} → ${r.body?.to ?? ''}`))
    .toEqual([`POST ${PUSH_PATH} → ${LINE_USER_B}`]);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 ' +
      'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts ' +
      '打到 tests/helpers/line-mock.ts 起的假 LINE。',
    );
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  await mock.start();

  for (const [tenantId, secret, token] of [
    [SHOP_A.id, CHANNEL_SECRET, CHANNEL_TOKEN],
    [SHOP_B.id, CHANNEL_SECRET_B, CHANNEL_TOKEN_B],
  ] as const) {
    const { data: snap, error: e0 } = await admin.from('tenant_settings')
      .select('notify, line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', tenantId).single();
    expect(e0).toBeNull();
    settingsSnapshot[tenantId] = snap as SettingsSnapshot;
    const { error: e1 } = await admin.from('tenant_settings').update({
      line_channel_secret_enc: encryptSecret(secret),
      line_channel_access_token_enc: encryptSecret(token),
    }).eq('tenant_id', tenantId);
    expect(e1).toBeNull();

    const { data: q } = await admin.from('push_quota_usage').select('used')
      .eq('tenant_id', tenantId).eq('month', taipeiMonthKey()).maybeSingle();
    quotaSnapshot[tenantId] = (q as { used: number } | null)?.used ?? null;
  }

  customerId = randomUUID();
  serviceId = randomUUID();
  staffId = randomUUID();

  const { error: e2 } = await admin.from('customers').insert({
    id: customerId, tenant_id: SHOP_A.id, name: '#7甲 狀態推播測試顧客',
    phone: '0900070003', line_user_id: LINE_USER,
  });
  expect(e2).toBeNull();
  const { error: e3 } = await admin.from('services').insert({
    id: serviceId, tenant_id: SHOP_A.id, name: '#7甲 狀態推播測試服務',
    duration_minutes: 60, price: 600,
  });
  expect(e3).toBeNull();
  const { error: e4 } = await admin.from('staff').insert({
    id: staffId, tenant_id: SHOP_A.id, name: '#7甲 狀態推播測試員工',
  });
  expect(e4).toBeNull();

  // 六筆預約：四個動作各一筆，加上兩筆給「額度用盡」用。時段各自錯開。
  const plan: { key: string; status: string; hours: number; no: string }[] = [
    { key: 'confirm', status: 'PENDING', hours: 400, no: 'B7ANOTIFY1' },
    { key: 'cancel', status: 'PENDING', hours: 404, no: 'B7ANOTIFY2' },
    { key: 'complete', status: 'CONFIRMED', hours: 408, no: 'B7ANOTIFY3' },
    { key: 'noShow', status: 'CONFIRMED', hours: 412, no: 'B7ANOTIFY4' },
    { key: 'quotaConfirm', status: 'PENDING', hours: 416, no: 'B7ANOTIFY5' },
    { key: 'quotaComplete', status: 'CONFIRMED', hours: 420, no: 'B7ANOTIFY6' },
    { key: 'switchOff', status: 'CONFIRMED', hours: 424, no: 'B7ANOTIFY7' },
  ];
  for (const p of plan) {
    const id = randomUUID();
    bookings[p.key] = id;
    const start = futureIso(p.hours);
    const { error } = await admin.from('bookings').insert({
      id, tenant_id: SHOP_A.id, customer_id: customerId, service_id: serviceId,
      staff_id: staffId, booking_no: p.no, status: p.status, payment_status: 'UNPAID',
      duration_minutes: 60, price: 600, final_price: 600, source: 'MANUAL',
      start_at: start, end_at: new Date(Date.parse(start) + 3_600_000).toISOString(), note: '',
    });
    expect(error).toBeNull();
  }

  // ---- 障壁用的 B 店資料（顧客已綁 LINE，三筆 PENDING 預約各給一個負向案例）----
  customerIdB = randomUUID();
  serviceIdB = randomUUID();
  const { error: eb1 } = await admin.from('customers').insert({
    id: customerIdB, tenant_id: SHOP_B.id, name: '#7甲 障壁顧客（B 店）',
    phone: '0900070009', line_user_id: LINE_USER_B,
  });
  expect(eb1).toBeNull();
  const { error: eb2 } = await admin.from('services').insert({
    id: serviceIdB, tenant_id: SHOP_B.id, name: '#7甲 障壁服務（B 店）',
    duration_minutes: 30, price: 100,
  });
  expect(eb2).toBeNull();
  const barrierPlan = [
    { key: 'quotaConfirm', hours: 500, no: 'B7ABARRIER1' },
    { key: 'quotaComplete', hours: 504, no: 'B7ABARRIER2' },
    { key: 'switchOff', hours: 508, no: 'B7ABARRIER3' },
  ];
  for (const p of barrierPlan) {
    const id = randomUUID();
    barrierBookings[p.key] = id;
    const start = futureIso(p.hours);
    const { error } = await admin.from('bookings').insert({
      id, tenant_id: SHOP_B.id, customer_id: customerIdB, service_id: serviceIdB,
      staff_id: null, booking_no: p.no, status: 'PENDING', payment_status: 'UNPAID',
      duration_minutes: 30, price: 100, final_price: 100, source: 'MANUAL',
      start_at: start, end_at: new Date(Date.parse(start) + 1_800_000).toISOString(), note: '',
    });
    expect(error).toBeNull();
  }
  // B 店的推播開關與額度：整檔固定（案例執行期間不再改動 → 障壁沒有競態）
  await setNotify({ notifyBookingConfirmed: true }, SHOP_B.id);
  await setQuotaUsed(0, SHOP_B.id);
});

afterAll(async () => {
  for (const id of [...Object.values(bookings), ...Object.values(barrierBookings)]) {
    await admin.from('bookings').delete().eq('id', id);
  }
  await admin.from('customer_point_logs').delete().eq('customer_id', customerId);
  await admin.from('customers').delete().eq('id', customerId);
  await admin.from('customers').delete().eq('id', customerIdB);
  await admin.from('staff').delete().eq('id', staffId);
  await admin.from('services').delete().eq('id', serviceId);
  await admin.from('services').delete().eq('id', serviceIdB);

  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    const snap = settingsSnapshot[tenantId];
    if (snap) {
      await admin.from('tenant_settings').update({
        notify: snap.notify,
        line_channel_secret_enc: snap.line_channel_secret_enc,
        line_channel_access_token_enc: snap.line_channel_access_token_enc,
      }).eq('tenant_id', tenantId);
    }
    if (quotaSnapshot[tenantId] == null) {
      await admin.from('push_quota_usage').delete()
        .eq('tenant_id', tenantId).eq('month', taipeiMonthKey());
    } else {
      await admin.from('push_quota_usage')
        .upsert({ tenant_id: tenantId, month: taipeiMonthKey(), used: quotaSnapshot[tenantId] });
    }
  }
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

/** 四個動作端點的共同斷言：mock 收到一則給該顧客的 push，內容是該 kind 的文案 */
async function expectPushedOnce(expectedTitle: string): Promise<void> {
  await waitForPushes(1);
  expect(mock.requestsFor(PUSH_PATH)).toHaveLength(1);
  const push = mock.requestsFor(PUSH_PATH)[0];
  expect(push.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
  expect(push.body.to).toBe(LINE_USER);
  const text = String(push.body.messages[0].text);
  expect(text).toContain(expectedTitle);                        // COPY[kind].title
  expect(text).toContain('#7甲 狀態推播測試服務');               // 服務名稱代入
  expect(await quotaUsed()).toBe(1);                            // 額度 -1
}

describe('預約狀態動作 → 顧客端 LINE 推播（06 §5）', () => {
  it('confirm → mock LINE 收到「預約已確認」push，推播額度 -1', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(0);

    const res = await ownerA.post(`/api/bookings/${bookings.confirm}/confirm`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Envelope).success).toBe(true);

    await expectPushedOnce('您的預約已確認');
    expect(await bookingStatus(bookings.confirm)).toBe('CONFIRMED');
  });

  it('cancel → mock LINE 收到「預約已取消」push，推播額度 -1', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(0);

    const res = await ownerA.post(`/api/bookings/${bookings.cancel}/cancel`, { reason: '#7甲 測試取消' });
    expect(res.status).toBe(200);

    await expectPushedOnce('您的預約已取消');
    expect(await bookingStatus(bookings.cancel)).toBe('CANCELLED');
  });

  it('complete → mock LINE 收到「感謝您今日的光臨」push，推播額度 -1', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(0);

    const res = await ownerA.post(`/api/bookings/${bookings.complete}/complete`);
    expect(res.status).toBe(200);

    await expectPushedOnce('感謝您今日的光臨');
    expect(await bookingStatus(bookings.complete)).toBe('COMPLETED');
  });

  it('no-show → mock LINE 收到「我們今日未能等到您」push，推播額度 -1', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(0);

    const res = await ownerA.post(`/api/bookings/${bookings.noShow}/no-show`);
    expect(res.status).toBe(200);

    await expectPushedOnce('我們今日未能等到您');
    expect(await bookingStatus(bookings.noShow)).toBe('NO_SHOW');
  });
});

describe('推播額度用盡 → 不打 LINE，但 API 本身仍成功（06 §5 步驟 3）', () => {
  it('confirm：額度填滿 → 整個 mock 一個請求都沒收到，API 仍 200、預約仍轉成 CONFIRMED', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(QUOTA_LIMIT);

    const res = await ownerA.post(`/api/bookings/${bookings.quotaConfirm}/confirm`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Envelope).success).toBe(true);

    await expectNoLineRequestExceptBarrier('quotaConfirm');
    expect(await quotaUsed()).toBe(QUOTA_LIMIT);                // 沒送出就不該扣
    expect(await bookingStatus(bookings.quotaConfirm)).toBe('CONFIRMED');
  });

  it('complete：額度填滿 → 零 LINE 請求，但完成動作與其副作用照常成立', async () => {
    await enableAllStatusNotifications();
    await setQuotaUsed(QUOTA_LIMIT);

    const res = await ownerA.post(`/api/bookings/${bookings.quotaComplete}/complete`);
    expect(res.status).toBe(200);

    await expectNoLineRequestExceptBarrier('quotaComplete');
    expect(await quotaUsed()).toBe(QUOTA_LIMIT);
    expect(await bookingStatus(bookings.quotaComplete)).toBe('COMPLETED');
  });
});

describe('通知開關關閉 → 不推播（證明上面四條是因為開關開著才推的）', () => {
  it('notifyBookingNoShow=false → no-show 仍 200，但零 LINE 請求、額度不變', async () => {
    await enableAllStatusNotifications();
    await setNotify({ notifyBookingNoShow: false });
    await setQuotaUsed(0);

    const res = await ownerA.post(`/api/bookings/${bookings.switchOff}/no-show`);
    expect(res.status).toBe(200);

    await expectNoLineRequestExceptBarrier('switchOff');
    expect(await quotaUsed()).toBe(0);
    expect(await bookingStatus(bookings.switchOff)).toBe('NO_SHOW');
  });
});
