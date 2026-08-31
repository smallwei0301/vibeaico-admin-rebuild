/**
 * Phase 7 cron 整合測試 — 12 分冊 §4「Phase 7（Cron）」：
 *   「每個 cron：無 Bearer 401；正例（service role 預置符合條件的資料 → 打 cron →
 *    驗結果）；防重發（reminder_sent_at / last_recall_at）；每日 50 上限。」
 * 契約出處：docs/integration/07（各 job 邏輯表）+ 0013 migration（防重發欄位）+
 * 09 分冊 §5（cron 逐店功能閘門）。實作：src/app/api/cron/{booking-reminders,
 * birthday-greetings,customer-recall,recurring-bookings}/route.ts。
 *
 * CRON_SECRET：同 feature-expiry.09 —— .env.test 的 TEST_CRON_SECRET 由
 * global-setup 映射成 next dev 的 CRON_SECRET，正例直接拿它當 Bearer。
 *
 * LINE 鏈路：推播類 cron（reminders / birthday / recall）最終打 LINE push API，
 * 走 .env.test 的 LINE_API_BASE=http://localhost:4123 → 本測試 process 起的
 * tests/helpers/line-mock.ts。SHOP_A 的 LINE 憑證照 line-webhook.06 的手法：
 * beforeAll 先快照 tenant_settings，encryptSecret() 寫入測試憑證，afterAll 還原。
 * SHOP_B 不設憑證、不動 —— 三支推播 cron 對它或者開關預設關（birthday/recall）、
 * 或者沒有符合條件的預約（reminders），不影響計數斷言。
 *
 * 測試資料（全自建於 SHOP_A，afterAll 清理）：
 *   - reminders：綁 LINE 顧客 + CONFIRMED 預約 start_at=now+24h（落在
 *     [now+23.5h, now+24.5h) 掃描窗）；防重發驗 reminder_sent_at 搶佔。
 *   - birthday：綁 LINE 顧客 birthday=今天（台北）；驗 push 文字=設定訊息、
 *     chat_messages 有 OUT；關閉開關再打 → greeted=0。
 *   - recall：綁 LINE 顧客 + 61 天前的 COMPLETED 預約（customers_view 的
 *     last_visit_at 由 COMPLETED bookings 的 max(start_at) 推導，見 0007 view
 *     定義 —— 所以「61 天沒來」必須用預約製造，不能只設 customers 欄位）；
 *     30 天冷卻驗 last_recall_at；50 上限用 51 位輕量顧客（admin 各一次批次
 *     insert 51 列 customers + 51 列 COMPLETED bookings，成本可接受）實測。
 *   - recurring：active 規則 weekday=明天（台北）的星期、time 11:00、
 *     intervalWeeks=1、until=+30 天 → 7 天視窗內恰好 1 場；再打驗防呆。
 *
 * 計數斷言的隔離依據：整合測試串行（--no-file-parallelism）且各檔 afterAll
 * 還原基線；birthday/recall 開關預設 false（只有本檔打開 SHOP_A），reminders
 * 的掃描窗（now+24h ±30min）不含 seed 的任何預約（seed CONFIRMED 在 now+3h）。
 *
 * 清理：afterAll 刪自建 chat_messages / bookings / recurring 規則與其產出 /
 * customers，還原 tenant_settings（notify + LINE 憑證欄）與 push_quota_usage
 * 當月列快照。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const PATH_REMINDERS = '/api/cron/booking-reminders';
const PATH_BIRTHDAY = '/api/cron/birthday-greetings';
const PATH_RECALL = '/api/cron/customer-recall';
const PATH_RECURRING = '/api/cron/recurring-bookings';
const PUSH_PATH = '/v2/bot/message/push';

/** 本檔專用 LINE 憑證（明文只存在測試裡；寫進 DB 前 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-cron07';
const CHANNEL_TOKEN = 'itest-line-access-token-cron07';

/** 本檔專用 LINE user id（不與 06 系列測試檔互踩） */
const LINE_REMINDER = 'Ucron07reminder000000000000000001';
const LINE_BIRTHDAY = 'Ucron07birthday000000000000000001';
const LINE_RECALL = 'Ucron07recall00000000000000000001';
const LINE_BULK_PREFIX = 'Ucron07bulk';

const BIRTHDAY_MESSAGE = '生日快樂！本月來店享 9 折（cron07 測試）';
const RECALL_MESSAGE = '好久不見，回來看看我們吧（cron07 測試）';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * HOUR_MS;

/** 51 位 = 每日 50 上限 + 1（原站規則，07 分冊 §2 recall 列） */
const BULK_COUNT = 51;

/** 與 src/server/tz.ts 同一 +08:00 假設的台北日曆欄位 */
function taipeiParts(atMs = Date.now()) {
  const t = new Date(atMs + TAIPEI_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}
function taipeiTodayDateString(): string {
  const { y, m, d } = taipeiParts();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** 台北 'YYYY-MM'（push_quota_usage.month，同 src/server/tz.ts） */
function taipeiMonthKey(): string {
  const { y, m } = taipeiParts();
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

interface RemindersResult { processedTenants: number; reminded: number }
interface BirthdayResult { processedTenants: number; greeted: number }
interface RecallResult { processedTenants: number; recalled: number }
interface RecurringResult { processedRules: number; created: number; skipped: number }

let admin: SupabaseClient;
let cronSecret: string;
const mock = new LineMockServer();

/** tenant_settings 快照（afterAll 還原） */
let settingsSnapshot: {
  notify: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
/** push_quota_usage 當月列快照（afterAll 還原；null = 原本沒有這列） */
let quotaSnapshot: number | null = null;

// ---- 自建資料 id（afterAll 清理用）----
const reminderCustomerId = randomUUID();
const reminderBookingId = randomUUID();
const birthdayCustomerId = randomUUID();
const recallCustomerId = randomUUID();
const recallBookingId = randomUUID();
const bulkCustomerIds: string[] = [];
const bulkBookingIds: string[] = [];
let recurringRuleId: string | null = null;
/** recurring 正例期望的 start_at（rule 建立時一併算好） */
let recurringStartIso = '';

function cronGet(path: string, withAuth: boolean): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: withAuth ? { Authorization: `Bearer ${cronSecret}` } : undefined,
  });
}

/** 整份覆寫 SHOP_A 的 notify 設定（notifySettingsSchema 會補齊未給的預設鍵） */
async function setNotify(notify: Record<string, unknown>): Promise<void> {
  const { error } = await admin
    .from('tenant_settings')
    .update({ notify })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

/** mock 收到的 push 請求（可依收件者過濾） */
function pushRequests(to?: string) {
  const all = mock.requestsFor(PUSH_PATH);
  return to === undefined ? all : all.filter((r) => r.body?.to === to);
}

/** Deferred outbox dispatch is post-commit; wait for the target mock request before asserting/resetting. */
async function waitForPush(to: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pushes = pushRequests(to);
    if (pushes.length > 0) return pushes;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return pushRequests(to);
}

async function outChatMessages(lineUserId: string) {
  const { data, error } = await admin
    .from('chat_messages')
    .select('id, content, message_type')
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', lineUserId)
    .eq('direction', 'OUT');
  expect(error).toBeNull();
  return (data ?? []) as { id: string; content: any; message_type: string }[];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy(); // 缺 = mock 鏈路沒接上，紅燈
  cronSecret = process.env.TEST_CRON_SECRET ?? '';
  expect(cronSecret).toBeTruthy(); // 同 feature-expiry.09：缺 = 環境壞掉

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await mock.start();

  // ---- SHOP_A：LINE 憑證 + notify 快照（afterAll 還原）----
  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('notify, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // ---- push_quota_usage 當月列快照 ----
  const { data: q, error: eQ } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(eQ).toBeNull();
  quotaSnapshot = (q as { used: number } | null)?.used ?? null;

  const now = Date.now();

  // ---- 顧客：reminders（綁 LINE）/ birthday（綁 LINE + 今天生日）/ recall（綁 LINE）----
  const todayMmDd = taipeiTodayDateString().slice(5);
  const { error: eC } = await admin.from('customers').insert([
    {
      id: reminderCustomerId, tenant_id: SHOP_A.id,
      name: '提醒測試顧客（cron07）', line_user_id: LINE_REMINDER,
    },
    {
      id: birthdayCustomerId, tenant_id: SHOP_A.id,
      name: '生日測試顧客（cron07）', line_user_id: LINE_BIRTHDAY,
      birthday: `1990-${todayMmDd}`,
    },
    {
      id: recallCustomerId, tenant_id: SHOP_A.id,
      name: '喚回測試顧客（cron07）', line_user_id: LINE_RECALL,
    },
  ]);
  expect(eC).toBeNull();

  // ---- 預約：reminders 的 CONFIRMED（start=now+24h，正中掃描窗）+
  //      recall 的 COMPLETED（61 天前 → customers_view.last_visit_at）----
  const { error: eB } = await admin.from('bookings').insert([
    {
      id: reminderBookingId, tenant_id: SHOP_A.id, booking_no: 'B7CRONRM01',
      customer_id: reminderCustomerId, service_id: SHOP_A.serviceA1, staff_id: null,
      start_at: new Date(now + 24 * HOUR_MS).toISOString(),
      end_at: new Date(now + 25 * HOUR_MS).toISOString(),
      duration_minutes: 60, price: 800, final_price: 800,
      status: 'CONFIRMED', source: 'MANUAL',
    },
    {
      id: recallBookingId, tenant_id: SHOP_A.id, booking_no: 'B7CRONRC01',
      customer_id: recallCustomerId, service_id: SHOP_A.serviceA1, staff_id: null,
      start_at: new Date(now - 61 * DAY_MS).toISOString(),
      end_at: new Date(now - 61 * DAY_MS + HOUR_MS).toISOString(),
      duration_minutes: 60, price: 800, final_price: 800,
      status: 'COMPLETED', source: 'MANUAL',
    },
  ]);
  expect(eB).toBeNull();
});

afterAll(async () => {
  // 順序：chat_messages → bookings（references customers）→ 規則 → customers → 設定
  const allLineIds = [
    LINE_REMINDER, LINE_BIRTHDAY, LINE_RECALL,
    ...bulkCustomerIds.map((_, i) => `${LINE_BULK_PREFIX}${String(i + 1).padStart(3, '0')}`),
  ];
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).in('line_user_id', allLineIds);

  await admin.from('bookings').delete()
    .in('id', [reminderBookingId, recallBookingId, ...bulkBookingIds]);
  // recurring cron 產出的預約（source='RECURRING' 只有本檔的規則會產）
  await admin.from('bookings').delete()
    .eq('tenant_id', SHOP_A.id)
    .eq('customer_id', SHOP_A.customerA2)
    .eq('service_id', SHOP_A.serviceA1)
    .eq('source', 'RECURRING');
  if (recurringRuleId) {
    await admin.from('recurring_bookings').delete().eq('id', recurringRuleId);
  }
  await admin.from('customers').delete()
    .in('id', [reminderCustomerId, birthdayCustomerId, recallCustomerId, ...bulkCustomerIds]);

  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      notify: settingsSnapshot.notify ?? {},
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }

  // push_quota_usage 還原快照（原本沒有列 → 刪掉本檔造出的列）
  if (quotaSnapshot === null) {
    await admin.from('push_quota_usage').delete()
      .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey());
  } else {
    await admin.from('push_quota_usage')
      .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaSnapshot });
  }

  await mock.stop();
});

describe('cron Bearer 驗證（07 分冊慣例：無 Bearer → 401）', () => {
  it.each([
    ['booking-reminders', PATH_REMINDERS],
    ['birthday-greetings', PATH_BIRTHDAY],
    ['customer-recall', PATH_RECALL],
    ['recurring-bookings', PATH_RECURRING],
  ])('%s：無 Bearer → 401', async (_name, path) => {
    const res = await cronGet(path, false);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('unauthorized');
  });
});

describe('GET /api/cron/booking-reminders（07 §2 + 0013 reminder_sent_at）', () => {
  it('正例：CONFIRMED 且 start_at=now+24h 的綁 LINE 預約 → reminded≥1、reminder_sent_at 非 null、mock 收到 push', async () => {
    await setNotify({ notifyBookingReminder: true, reminderHoursBefore: 24 });
    mock.reset();

    const res = await cronGet(PATH_REMINDERS, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RemindersResult;
    expect(body.reminded).toBeGreaterThanOrEqual(1);

    const { data: b, error } = await admin
      .from('bookings')
      .select('reminder_sent_at')
      .eq('id', reminderBookingId)
      .single();
    expect(error).toBeNull();
    expect(b!.reminder_sent_at).not.toBeNull();

    // mock 收到對該顧客的 push（帶解密後 token；文案是 REMINDER 樣板）
    const pushes = await waitForPush(LINE_REMINDER);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(pushes[0].body.messages[0].type).toBe('text');
    expect(pushes[0].body.messages[0].text).toContain('預約提醒');
  });

  it('防重發：再打一次 → reminded=0、mock 無新 push（reminder_sent_at 已佔）', async () => {
    mock.reset();
    const res = await cronGet(PATH_REMINDERS, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RemindersResult;
    expect(body.reminded).toBe(0);
    expect(pushRequests()).toHaveLength(0);
  });
});

describe('GET /api/cron/birthday-greetings（07 §2）', () => {
  it('正例：開關+訊息、顧客今天（台北）生日且綁 LINE → greeted=1、push 文字=設定訊息、chat_messages 有 OUT', async () => {
    await setNotify({ enableBirthdayGreeting: true, birthdayGreetingMessage: BIRTHDAY_MESSAGE });
    mock.reset();

    const res = await cronGet(PATH_BIRTHDAY, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BirthdayResult;
    // 只有 SHOP_A 開了開關（enableBirthdayGreeting 預設 false），且只有本檔的
    // 生日顧客符合「月-日=今天」→ 全域計數就是 1
    expect(body.processedTenants).toBe(1);
    expect(body.greeted).toBe(1);

    const pushes = pushRequests(LINE_BIRTHDAY);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body.messages).toEqual([{ type: 'text', text: BIRTHDAY_MESSAGE }]);

    const outs = await outChatMessages(LINE_BIRTHDAY);
    expect(outs).toHaveLength(1);
    expect(outs[0].content?.text).toBe(BIRTHDAY_MESSAGE);
  });

  it('關閉開關再打 → greeted=0、無 push、不新增 OUT 訊息', async () => {
    await setNotify({ enableBirthdayGreeting: false, birthdayGreetingMessage: BIRTHDAY_MESSAGE });
    mock.reset();

    const res = await cronGet(PATH_BIRTHDAY, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BirthdayResult;
    expect(body.processedTenants).toBe(0);
    expect(body.greeted).toBe(0);
    expect(pushRequests()).toHaveLength(0);
    expect(await outChatMessages(LINE_BIRTHDAY)).toHaveLength(1); // 仍是第一輪那筆
  });
});

describe('GET /api/cron/customer-recall（07 §2 + 0013 last_recall_at）', () => {
  it('正例：61 天前 COMPLETED 的綁 LINE 顧客 → recalled=1、last_recall_at 非 null、push 文字=設定訊息、chat_messages 有 OUT', async () => {
    await setNotify({
      enableCustomerRecall: true,
      customerRecallDays: 60,
      customerRecallMessage: RECALL_MESSAGE,
    });
    mock.reset();

    const res = await cronGet(PATH_RECALL, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecallResult;
    // 只有 SHOP_A 開了開關（enableCustomerRecall 預設 false）；seed 顧客的
    // last_visit_at 要嘛 null（無 COMPLETED 預約 → 查詢排除）要嘛是 now-2h
    // （bookingCompleted）→ 只有本檔 61 天前那位符合 → recalled=1
    expect(body.recalled).toBe(1);

    const { data: c, error } = await admin
      .from('customers')
      .select('last_recall_at')
      .eq('id', recallCustomerId)
      .single();
    expect(error).toBeNull();
    expect(c!.last_recall_at).not.toBeNull();

    const pushes = pushRequests(LINE_RECALL);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body.messages).toEqual([{ type: 'text', text: RECALL_MESSAGE }]);

    const outs = await outChatMessages(LINE_RECALL);
    expect(outs).toHaveLength(1);
    expect(outs[0].content?.text).toBe(RECALL_MESSAGE);
  });

  it('30 天冷卻：再打一次 → recalled=0、無新 push（last_recall_at 防重）', async () => {
    // 前置斷言：上一案例必須真的推過（last_recall_at 已標記）。少了這條，
    // 正例若整個沒跑（例如查詢直接失敗 → recalled 恆 0），本案例會「空轉變綠」。
    const { data: pre, error: ePre } = await admin
      .from('customers')
      .select('last_recall_at')
      .eq('id', recallCustomerId)
      .single();
    expect(ePre).toBeNull();
    expect(pre!.last_recall_at).not.toBeNull();

    mock.reset();
    const res = await cronGet(PATH_RECALL, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecallResult;
    expect(body.recalled).toBe(0);
    expect(pushRequests()).toHaveLength(0);
  });

  it(
    '每日 50 上限：51 位符合條件的顧客 → recalled=50，恰好 1 位未被標記 last_recall_at',
    async () => {
      // 51 位輕量顧客（admin 批次 insert 一次 51 列）+ 51 筆 61 天前的 COMPLETED
      // 預約（last_visit_at 由 view 從 COMPLETED bookings 推導，見檔頭）
      const now = Date.now();
      const visitIso = new Date(now - 61 * DAY_MS).toISOString();
      const visitEndIso = new Date(now - 61 * DAY_MS + HOUR_MS).toISOString();
      const customers = Array.from({ length: BULK_COUNT }, (_, i) => ({
        id: randomUUID(),
        tenant_id: SHOP_A.id,
        name: `喚回上限測試顧客 ${i + 1}（cron07）`,
        line_user_id: `${LINE_BULK_PREFIX}${String(i + 1).padStart(3, '0')}`,
      }));
      bulkCustomerIds.push(...customers.map((c) => c.id));
      const bookings = customers.map((c, i) => ({
        id: randomUUID(),
        tenant_id: SHOP_A.id,
        booking_no: `B7CRONBK${String(i + 1).padStart(3, '0')}`,
        customer_id: c.id,
        service_id: SHOP_A.serviceA1,
        staff_id: null, // 不佔用排除約束（且 COMPLETED 本就不在約束範圍）
        start_at: visitIso,
        end_at: visitEndIso,
        duration_minutes: 60,
        price: 0,
        final_price: 0,
        status: 'COMPLETED',
        source: 'MANUAL',
      }));
      bulkBookingIds.push(...bookings.map((b) => b.id));

      const { error: eC } = await admin.from('customers').insert(customers);
      expect(eC).toBeNull();
      const { error: eB } = await admin.from('bookings').insert(bookings);
      expect(eB).toBeNull();

      mock.reset();
      const res = await cronGet(PATH_RECALL, true);
      expect(res.status).toBe(200);
      const body = (await res.json()) as RecallResult;
      // 前一案例那位在 30 天冷卻中 → 候選恰為 51 位，limit 50 → recalled=50
      expect(body.recalled).toBe(50);
      expect(pushRequests()).toHaveLength(50);

      const { data: left, error: eL } = await admin
        .from('customers')
        .select('id')
        .in('id', bulkCustomerIds)
        .is('last_recall_at', null);
      expect(eL).toBeNull();
      expect(left).toHaveLength(1); // 51 − 50 = 恰好 1 位未推
    },
    180_000, // 50 次推播 × 每次 4 個 DB 往返（額度/推播/標記/訊息），放寬逾時
  );
});

describe('GET /api/cron/recurring-bookings（07 §2）', () => {
  it('正例：active 規則 weekday=明天 → created≥1、bookings 出現 source=RECURRING status=CONFIRMED', async () => {
    // 明天（台北）的日曆欄位與星期；rule.time='11:00' → 期望 start_at =
    // 明天台北 00:00 的 UTC 瞬間 + 11 小時（cron 的錨點演算法，+08:00 固定）
    const { y, m, d } = taipeiParts();
    const tomorrowStartMs = Date.UTC(y, m, d + 1) - TAIPEI_OFFSET_MS;
    const weekday = new Date(Date.UTC(y, m, d + 1)).getUTCDay();
    recurringStartIso = new Date(tomorrowStartMs + 11 * HOUR_MS).toISOString();
    const until = new Date(Date.now() + TAIPEI_OFFSET_MS + 30 * DAY_MS)
      .toISOString().slice(0, 10);

    const { data: rule, error: eR } = await admin
      .from('recurring_bookings')
      .insert({
        tenant_id: SHOP_A.id,
        customer_id: SHOP_A.customerA2,
        service_id: SHOP_A.serviceA1,
        staff_id: null,
        rule: { weekday, time: '11:00', intervalWeeks: 1, until },
        active: true,
      })
      .select('id')
      .single();
    expect(eR).toBeNull();
    recurringRuleId = (rule as { id: string }).id;

    const res = await cronGet(PATH_RECURRING, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecurringResult;
    expect(body.processedRules).toBeGreaterThanOrEqual(1);
    expect(body.created).toBeGreaterThanOrEqual(1);

    const { data: made, error: eM } = await admin
      .from('bookings')
      .select('id, source, status, booking_no, end_at')
      .eq('tenant_id', SHOP_A.id)
      .eq('customer_id', SHOP_A.customerA2)
      .eq('service_id', SHOP_A.serviceA1)
      .eq('start_at', recurringStartIso);
    expect(eM).toBeNull();
    expect(made).toHaveLength(1); // intervalWeeks=1 → 7 天視窗內恰 1 場
    expect(made![0].source).toBe('RECURRING');
    expect(made![0].status).toBe('CONFIRMED');
  });

  it('防呆：再打一次 → created=0，同一時刻不重複建（既有 CONFIRMED 命中防呆）', async () => {
    const res = await cronGet(PATH_RECURRING, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecurringResult;
    expect(body.created).toBe(0);
    expect(body.skipped).toBeGreaterThanOrEqual(1); // 本檔規則的那一場被跳過

    const { data: made, error } = await admin
      .from('bookings')
      .select('id')
      .eq('tenant_id', SHOP_A.id)
      .eq('customer_id', SHOP_A.customerA2)
      .eq('service_id', SHOP_A.serviceA1)
      .eq('start_at', recurringStartIso);
    expect(error).toBeNull();
    expect(made).toHaveLength(1); // 仍只有一筆
  });
});
