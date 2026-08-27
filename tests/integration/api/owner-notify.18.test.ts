/**
 * LINE 老闆通知（owner-notify）整合測試 — GitHub issue #18 / 補齊-3
 * -----------------------------------------------------------------------------
 * 契約出處：`docs/integration/06-LINE-INTEGRATION.md` §5.5（本 issue 新增），
 * 原站事實基準：`docs/specs/dashboard.json` 的 `jsApiCalls` 與 `jsStrings`。
 * 實作：`src/server/owner-notify.ts`、`src/app/api/settings/line/owner-notify/**`、
 * `src/app/api/cron/owner-reminders/route.ts`、`POST /api/bookings` 的觸發點。
 *
 * ⚠️ 檔名：repo 慣例是 `<主題>.<issue/phase>.test.ts`（現有 47 檔全部帶後綴），
 * issue #18 驗收清單寫的是 `owner-notify.test.ts`。這裡照慣例加 `.18`，
 * 差異已在 issue 留言說明。
 *
 * ## 額度斷言為什麼要測「兩種 n」
 * 規格逐字：「每次通知會同時發給 ${n} 位（消耗 ${n} 則推播額度）」。
 * 只測 n=1 的話，「發一則」與「每位一則」兩種實作看起來一模一樣——把
 * `consumePushQuota(tenantId, recipients.length)` 寫成 `(tenantId, 1)` 不會紅。
 * 因此 n=1、n=3、n=0 三種都各有一個案例，斷言「n 位 → n 則 → 額度 +n」。
 *
 * ## 反向斷言（「不該被通知的人沒被通知」）的寫法
 * 一律斷言**整個 `mock.requests`** 只含障壁那一則，不是「/push 沒被打」——
 * 斷言某一支沒被打，擋不住「改成打了別支」（multicast / narrowcast）。
 * 這是本專案既有慣例（line-booking-notify.06 檔頭、chat-link.06）。
 *
 * 障壁（barrier）而不是固定秒數：`bookings-modified.27` 的 1 秒窗已被實測證明會
 * 假綠（14 分冊 §6.16-a）。本檔的障壁 = 在 **SHOP_B**（獨立額度／設定／憑證／名單）
 * 建立一筆預約，它必定推一則給 B 店的接收者；等那一則抵達 mock 之後，A 店那次
 * 若有請求早就到了（兩者走同一支 notifyOwnerNewBooking、同一組 DB 往返，且受測那次
 * **更早**發動——障壁的 HTTP 請求要等前一個回應完才送出）。
 *
 * ## 本檔沒有 webhook 步驟
 * 「是我，綁定通知」是**後台儀表板上的按鈕**（`dashboard.json` 的 `jsApiCalls`
 * 列了 `/api/settings/line/owner-notify/bind`，確認文案「確認是您本人嗎？」是後台的
 * confirm 視窗），不是顧客在 LINE 裡點的，所以不經過 webhook，也就沒有
 * `drainWebhook()` 的需要。原 issue 的「webhook 認綁定碼」整段已於 2026-08-25 作廢。
 *
 * 清理紀律：自建 line_users / owner_notify_recipients / 顧客 / 服務 / 預約
 * 於 afterAll 依 FK 方向刪回；兩店的 tenant_settings（兩個 *_enc）與
 * push_quota_usage 當月列先快照後還原；動到的 feature_subscriptions 還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const PUSH_PATH = '/v2/bot/message/push';
const INFO_PATH = '/v2/bot/info';

const OWNER_NOTIFY = '/api/settings/line/owner-notify';

const CHANNEL_SECRET_A = 'itest-line-secret-18-owner';
const CHANNEL_TOKEN_A = 'itest-line-token-18-owner';
const CHANNEL_SECRET_B = 'itest-line-secret-18-owner-b';
const CHANNEL_TOKEN_B = 'itest-line-token-18-owner-b';

/** A 店的四位好友（U1~U3 用來組名單，U4 是「第 4 位」用來撞上限） */
const U1 = 'U18owner0000000000000000000000a1';
const U2 = 'U18owner0000000000000000000000a2';
const U3 = 'U18owner0000000000000000000000a3';
const U4 = 'U18owner0000000000000000000000a4';
/** 已封鎖（followed=false）→ 不可出現在可加入清單 */
const U5_BLOCKED = 'U18owner0000000000000000000000a5';
/** B 店的障壁接收者 */
const UB = 'U18owner0000000000000000000000b1';

const NAMES: Record<string, string> = {
  [U1]: '#18 老闆本人',
  [U2]: '#18 店長',
  [U3]: '#18 副店長',
  [U4]: '#18 第四位',
  [U5_BLOCKED]: '#18 已封鎖的好友',
  [UB]: '#18 障壁接收者（B 店）',
};

/** SHOP_A 種子含 EXTRA_PUSH → 推播上限 700（09 分冊 §5、src/server/line.ts） */
const QUOTA_LIMIT = 700;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type Recipient = {
  id: string; lineUserId: string; displayName: string; isPrimary: boolean; createdAt: string;
};
type State = { status: string; recipients: Recipient[]; maxRecipients: number };

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00） */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let cronSecret: string;
const mock = new LineMockServer();

let serviceA: string;
let customerA: string;
let serviceB: string;
let customerB: string;
/** 每次建立預約錯開時段，避免與其他檔／彼此互相干擾（未指定員工，不受重疊約束） */
let hourCursor = 900;

type SettingsSnapshot = { line_channel_secret_enc: string; line_channel_access_token_enc: string };
const settingsSnapshot: Record<string, SettingsSnapshot | null> = {};
const quotaSnapshot: Record<string, number | null> = {};
const createdBookings: string[] = [];

function futureIso(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

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

/** service role 直查名單（不經端點——端點自己壞掉時這裡才看得出來） */
async function dbRecipients(tenantId: string = SHOP_A.id) {
  const { data, error } = await admin.from('owner_notify_recipients')
    .select('line_user_id, is_primary, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as { line_user_id: string; is_primary: boolean; created_at: string }[];
}

/** 直接以 service role 佈名單（測「移除」時不想讓「加入」的 bug 汙染前提） */
async function seedRecipients(users: string[], tenantId: string = SHOP_A.id): Promise<void> {
  await admin.from('owner_notify_recipients').delete().eq('tenant_id', tenantId);
  for (let i = 0; i < users.length; i++) {
    const { error } = await admin.from('owner_notify_recipients').insert({
      tenant_id: tenantId, line_user_id: users[i], is_primary: i === 0,
      // created_at 明確錯開，順序才是確定的（同一毫秒插入會讓「下一位」不唯一）
      created_at: new Date(Date.now() - (users.length - i) * 1000).toISOString(),
    });
    expect(error).toBeNull();
  }
}

async function getState(api: AuthedApi = ownerA): Promise<State> {
  const res = await api.get(OWNER_NOTIFY);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Envelope<State>;
  expect(body.success).toBe(true);
  return body.data!;
}

/** 建立一筆預約（＝「新預約」觸發點）；回 booking id */
async function createBooking(api: AuthedApi, customerId: string, serviceId: string): Promise<string> {
  hourCursor += 4;
  const res = await api.post('/api/bookings', {
    customerId, serviceId, startAt: futureIso(hourCursor), note: '#18 owner-notify',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Envelope<{ id: string }>;
  expect(body.success).toBe(true);
  createdBookings.push(body.data!.id);
  return body.data!.id;
}

/** 輪詢等條件成立（12 §2.3 允許的輪詢；逾時＝紅燈，不會假綠） */
async function waitUntil(cond: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `等不到「${label}」。mock 收到的請求：`
    + `${mock.requests.map((r) => `${r.method} ${r.path}→${r.body?.to ?? ''}`).join(', ') || '（無）'}`,
  );
}

const pushes = () => mock.requestsFor(PUSH_PATH);
const pushTargets = () => pushes().map((r) => String(r.body?.to ?? ''));

/**
 * 障壁：在 B 店建立一筆預約 → 必定推一則給 UB。等它抵達後，斷言 mock 收到的
 * **全部**請求就只有那一則（見檔頭「反向斷言」）。
 */
async function expectNoRequestExceptBarrier(): Promise<void> {
  await createBooking(ownerB, customerB, serviceB);
  await waitUntil(() => pushes().some((r) => r.body?.to === UB), '障壁：B 店的 push 抵達 mock');
  expect(mock.requests.map((r) => `${r.method} ${r.path} → ${r.body?.to ?? ''}`))
    .toEqual([`POST ${PUSH_PATH} → ${UB}`]);
}

async function callCron(): Promise<Response> {
  return fetch(`${BASE_URL}/api/cron/owner-reminders`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 '
      + 'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts '
      + '打到 tests/helpers/line-mock.ts 起的假 LINE。',
    );
  }
  cronSecret = process.env.TEST_CRON_SECRET ?? '';
  expect(cronSecret).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  await mock.start();

  for (const [tenantId, secret, token] of [
    [SHOP_A.id, CHANNEL_SECRET_A, CHANNEL_TOKEN_A],
    [SHOP_B.id, CHANNEL_SECRET_B, CHANNEL_TOKEN_B],
  ] as const) {
    const { data: snap, error: e0 } = await admin.from('tenant_settings')
      .select('line_channel_secret_enc, line_channel_access_token_enc')
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

  // 好友清單（U5 是已封鎖的：followed=false）
  for (const [tenantId, users] of [
    [SHOP_A.id, [U1, U2, U3, U4, U5_BLOCKED]],
    [SHOP_B.id, [UB]],
  ] as const) {
    for (const u of users) {
      const { error } = await admin.from('line_users').insert({
        tenant_id: tenantId, line_user_id: u, display_name: NAMES[u],
        picture_url: '', followed: u !== U5_BLOCKED,
      });
      expect(error).toBeNull();
    }
  }

  // 兩店各一組服務＋顧客。顧客**不綁 LINE**——否則顧客通道也會推，
  // 「恰好 n 則」的斷言就分不出是哪一條通道送的。
  serviceA = randomUUID(); customerA = randomUUID();
  serviceB = randomUUID(); customerB = randomUUID();
  for (const [tenantId, sid, cid, tag] of [
    [SHOP_A.id, serviceA, customerA, 'A'],
    [SHOP_B.id, serviceB, customerB, 'B'],
  ] as const) {
    const { error: es } = await admin.from('services').insert({
      id: sid, tenant_id: tenantId, name: `#18 老闆通知測試服務（${tag} 店）`,
      duration_minutes: 30, price: 300,
    });
    expect(es).toBeNull();
    const { error: ec } = await admin.from('customers').insert({
      id: cid, tenant_id: tenantId, name: `#18 老闆通知測試顧客（${tag} 店）`,
      phone: tag === 'A' ? '0900180001' : '0900180002',
    });
    expect(ec).toBeNull();
  }

  // B 店固定一位主要接收者（障壁用），整檔不再改動 → 障壁沒有競態
  await seedRecipients([UB], SHOP_B.id);
  await setQuotaUsed(0, SHOP_B.id);
});

afterAll(async () => {
  for (const id of createdBookings) await admin.from('bookings').delete().eq('id', id);
  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    await admin.from('owner_notify_recipients').delete().eq('tenant_id', tenantId);
    await admin.from('owner_notify_reminder_log').delete().eq('tenant_id', tenantId);
    await admin.from('line_users').delete().eq('tenant_id', tenantId)
      .in('line_user_id', [U1, U2, U3, U4, U5_BLOCKED, UB]);
  }
  await admin.from('feature_subscriptions').delete()
    .eq('tenant_id', SHOP_A.id).eq('code', 'ONLINE_BOOKING');
  // 種子的 COUPON_SYSTEM 是永久（expires_at null）——本檔曾暫時改成即將到期
  await admin.from('feature_subscriptions').update({ expires_at: null })
    .eq('tenant_id', SHOP_A.id).eq('code', 'COUPON_SYSTEM');

  for (const cid of [customerA, customerB]) await admin.from('customers').delete().eq('id', cid);
  for (const sid of [serviceA, serviceB]) await admin.from('services').delete().eq('id', sid);

  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    const snap = settingsSnapshot[tenantId];
    if (snap) {
      await admin.from('tenant_settings').update({
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

beforeEach(async () => {
  mock.reset();
  await admin.from('owner_notify_recipients').delete().eq('tenant_id', SHOP_A.id);
  await admin.from('owner_notify_reminder_log').delete().eq('tenant_id', SHOP_A.id);
  // 提醒類案例會塞「即將到期」的訂閱列；每個案例都要從「沒有任何即將到期訂閱」
  // 出發，否則上一個案例留下的那一張會讓「恰好 1 則」多出一則。
  await admin.from('feature_subscriptions').delete()
    .eq('tenant_id', SHOP_A.id).eq('code', 'ONLINE_BOOKING');
  await admin.from('feature_subscriptions').update({ expires_at: null })
    .eq('tenant_id', SHOP_A.id).eq('code', 'COUPON_SYSTEM');
  await setQuotaUsed(0);
});

/* ==================================================== ① 可加入的好友清單 */

describe('GET /api/settings/line/owner-notify/line-users（可加入的 LINE 好友）', () => {
  it('只回「已加入好友、且尚未在名單中」的人（已在名單者與已封鎖者都被排除）', async () => {
    await seedRecipients([U1]);

    const res = await ownerA.get(`${OWNER_NOTIFY}/line-users`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ lineUsers: { lineUserId: string }[] }>;
    const ids = body.data!.lineUsers.map((u) => u.lineUserId);

    expect(ids).toEqual(expect.arrayContaining([U2, U3, U4]));
    expect(ids).not.toContain(U1);            // 已在名單中
    expect(ids).not.toContain(U5_BLOCKED);    // followed=false

    // 直查：名單裡確實只有 U1（清單是從這份資料算出來的，不是回傳值自圓其說）
    expect((await dbRecipients()).map((r) => r.line_user_id)).toEqual([U1]);
  });
});

/* ================================================ ② bind（本人自我認領） */

describe('POST /api/settings/line/owner-notify/bind（是我，綁定通知）', () => {
  it('本人認領後名單寫入 DB（service role 直查有這一列）', async () => {
    const res = await ownerA.post(`${OWNER_NOTIFY}/bind`, { lineUserId: U1 });
    expect(res.status).toBe(200);

    const rows = await dbRecipients();
    expect(rows).toHaveLength(1);
    expect(rows[0].line_user_id).toBe(U1);
  });

  it('名單原本為空時，第一位自動成為主要（直查 is_primary=true）', async () => {
    const res = await ownerA.post(`${OWNER_NOTIFY}/bind`, { lineUserId: U2 });
    expect(res.status).toBe(200);

    const rows = await dbRecipients();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line_user_id: U2, is_primary: true });
  });

  it('不是該店好友（或已封鎖）→ 404，名單不變', async () => {
    const res = await ownerA.post(`${OWNER_NOTIFY}/bind`, { lineUserId: U5_BLOCKED });
    expect(res.status).toBe(404);
    expect(await dbRecipients()).toHaveLength(0);
  });
});

/* ============================================ ③ recipients/:id（加入） */

describe('POST /api/settings/line/owner-notify/recipients/:id（新增接收者）', () => {
  it('加入第二位後，主要仍是第一位（新加入者不是主要）', async () => {
    await ownerA.post(`${OWNER_NOTIFY}/bind`, { lineUserId: U1 });
    const res = await ownerA.post(`${OWNER_NOTIFY}/recipients/${U2}`);
    expect(res.status).toBe(200);

    const rows = await dbRecipients();
    expect(rows.map((r) => [r.line_user_id, r.is_primary]))
      .toEqual([[U1, true], [U2, false]]);
  });

  it('達 maxRecipients（3 位）時第 4 位被拒，錯誤訊息說得出上限是幾位', async () => {
    await seedRecipients([U1, U2, U3]);
    const state = await getState();
    expect(state.maxRecipients).toBe(3);

    const res = await ownerA.post(`${OWNER_NOTIFY}/recipients/${U4}`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.message).toContain('已達上限 3 位');

    expect((await dbRecipients()).map((r) => r.line_user_id)).toEqual([U1, U2, U3]);
  });
});

/* ============================================ ④ recipients/:id（移除） */

describe('DELETE /api/settings/line/owner-notify/recipients/:id（移出通知名單）', () => {
  it('移除非主要 → 其他接收者不受影響（主要沒有換人）', async () => {
    await seedRecipients([U1, U2, U3]);

    const res = await ownerA.delete(`${OWNER_NOTIFY}/recipients/${U3}`);
    expect(res.status).toBe(200);

    expect((await dbRecipients()).map((r) => [r.line_user_id, r.is_primary]))
      .toEqual([[U1, true], [U2, false]]);
  });

  it('移除主要 → 下一位自動遞補為主要（直查 is_primary）', async () => {
    await seedRecipients([U1, U2, U3]);

    const res = await ownerA.delete(`${OWNER_NOTIFY}/recipients/${U1}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ promoted: Recipient | null }>;
    expect(body.data!.promoted?.lineUserId).toBe(U2);

    expect((await dbRecipients()).map((r) => [r.line_user_id, r.is_primary]))
      .toEqual([[U2, true], [U3, false]]);
  });

  it('移除最後一位 → 名單為空（規格逐字：之後不再收到 LINE 即時通知）', async () => {
    await seedRecipients([U1]);

    const res = await ownerA.delete(`${OWNER_NOTIFY}/recipients/${U1}`);
    expect(res.status).toBe(200);

    expect(await dbRecipients()).toHaveLength(0);
    expect((await getState()).status).toBe('NO_RECIPIENTS');
  });
});

/* ==================================================== ⑤ 解除全部 */

describe('DELETE /api/settings/line/owner-notify（解除全部）', () => {
  it('解除全部後名單為空', async () => {
    await seedRecipients([U1, U2, U3]);

    const res = await ownerA.delete(OWNER_NOTIFY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ removed: number }>;
    expect(body.data!.removed).toBe(3);

    expect(await dbRecipients()).toHaveLength(0);
  });

  it('解除全部後建立預約 → 整個 mock 一個請求都沒有（只有障壁那一則），額度不變', async () => {
    await seedRecipients([U1, U2, U3]);
    await ownerA.delete(OWNER_NOTIFY);
    await setQuotaUsed(0);

    await createBooking(ownerA, customerA, serviceA);

    await expectNoRequestExceptBarrier();
    expect(await quotaUsed()).toBe(0);
  });
});

/* ============================================ ⑥ 額度與人數連動（n 位 → n 則） */

describe('新預約 → 老闆通知：額度消耗與接收者人數連動（規格逐字 n 位 = n 則）', () => {
  it('名單 1 位 → mock LINE 恰好 1 則、push_quota_usage +1', async () => {
    await seedRecipients([U1]);

    await createBooking(ownerA, customerA, serviceA);

    await waitUntil(() => pushes().length >= 1, '1 則 push 抵達');
    expect(pushes()).toHaveLength(1);
    expect(pushTargets()).toEqual([U1]);
    expect(String(pushes()[0].body.messages[0].text)).toContain('收到新預約');
    expect(await quotaUsed()).toBe(1);
  });

  it('名單 3 位 → mock LINE 恰好 3 則（收件者＝名單三位）、push_quota_usage +3', async () => {
    await seedRecipients([U1, U2, U3]);

    await createBooking(ownerA, customerA, serviceA);

    await waitUntil(() => pushes().length >= 3, '3 則 push 抵達');
    expect(pushes()).toHaveLength(3);
    expect(pushTargets().sort()).toEqual([U1, U2, U3].sort());
    expect(await quotaUsed()).toBe(3);
  });

  it('名單 0 位 → 零 LINE 請求、額度 +0', async () => {
    expect(await dbRecipients()).toHaveLength(0);

    await createBooking(ownerA, customerA, serviceA);

    await expectNoRequestExceptBarrier();
    expect(await quotaUsed()).toBe(0);
  });

  it('額度用盡 → 預約仍建立成功，但一則都不發、額度不變', async () => {
    await seedRecipients([U1, U2, U3]);
    await setQuotaUsed(QUOTA_LIMIT - 2);         // 剩 2 則，發 3 位不夠

    const id = await createBooking(ownerA, customerA, serviceA);

    await expectNoRequestExceptBarrier();
    expect(await quotaUsed()).toBe(QUOTA_LIMIT - 2);   // 沒送出就不該扣
    const { data } = await admin.from('bookings').select('id').eq('id', id).maybeSingle();
    expect(data?.id).toBe(id);                          // 預約本身照常成立
  });
});

/* ==================================== ⑦ 訂閱到期／儲值提醒：只發主要一位 */

describe('cron /api/cron/owner-reminders：訂閱到期／儲值提醒只發給「主要」一位', () => {
  it('無 Bearer → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/owner-reminders`);
    expect(res.status).toBe(401);
  });

  it('訂閱到期提醒：名單 3 位時 mock LINE 恰好 1 則，且收件者＝is_primary 那位', async () => {
    await seedRecipients([U1, U2, U3]);
    // 免費功能（FEATURE_CATALOG price=0）→ 續訂所需點數為 0，儲值提醒不會一起發，
    // 這一條才驗得出「到期提醒本身」只發一位。
    const { error } = await admin.from('feature_subscriptions').upsert({
      tenant_id: SHOP_A.id, code: 'ONLINE_BOOKING', active: true,
      expires_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    }, { onConflict: 'tenant_id,code' });
    expect(error).toBeNull();

    const res = await callCron();
    expect(res.status).toBe(200);

    await waitUntil(() => pushes().length >= 1, '訂閱到期提醒抵達');
    expect(mock.requests.map((r) => `${r.method} ${r.path} → ${r.body?.to ?? ''}`))
      .toEqual([`POST ${PUSH_PATH} → ${U1}`]);           // U2/U3 一則都沒有
    expect(String(pushes()[0].body.messages[0].text)).toContain('訂閱即將到期');
    expect(await quotaUsed()).toBe(1);                    // 一位 → 一則
  });

  it('儲值提醒：點數不足時同樣只發主要一位', async () => {
    await seedRecipients([U1, U2, U3]);
    const expiresAt = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    const { data: sub, error } = await admin.from('feature_subscriptions')
      .update({ active: true, expires_at: expiresAt })
      .eq('tenant_id', SHOP_A.id).eq('code', 'COUPON_SYSTEM')
      .select('expires_at').single();
    expect(error).toBeNull();
    // 到期提醒先標成已送（用真的去重機制），這一條就只剩儲值提醒會發。
    // ⚠️ ref 必須用**資料庫回讀的** expires_at 字串，不是送進去的 JS ISO——
    // PostgREST 回的是 '…+00:00'、JS 給的是 '…Z'，字串不同就對不上這把去重鍵
    // （第一版就是這樣寫的，於是到期提醒照樣送出，這條案例收到 2 則而不是 1 則）。
    await admin.from('owner_notify_reminder_log').insert({
      tenant_id: SHOP_A.id, kind: 'SUBSCRIPTION_EXPIRY',
      ref: `COUPON_SYSTEM@${sub!.expires_at}`,
    });

    const res = await callCron();
    expect(res.status).toBe(200);

    await waitUntil(() => pushes().length >= 1, '儲值提醒抵達');
    expect(mock.requests.map((r) => `${r.method} ${r.path} → ${r.body?.to ?? ''}`))
      .toEqual([`POST ${PUSH_PATH} → ${U1}`]);
    expect(String(pushes()[0].body.messages[0].text)).toContain('點數不足');

    await admin.from('feature_subscriptions').update({ expires_at: null })
      .eq('tenant_id', SHOP_A.id).eq('code', 'COUPON_SYSTEM');
  });

  it('同一張訂閱不會重複提醒：連打兩次 cron，第二次零 LINE 請求', async () => {
    await seedRecipients([U1]);
    const { error } = await admin.from('feature_subscriptions').upsert({
      tenant_id: SHOP_A.id, code: 'ONLINE_BOOKING', active: true,
      expires_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    }, { onConflict: 'tenant_id,code' });
    expect(error).toBeNull();

    expect((await callCron()).status).toBe(200);
    await waitUntil(() => pushes().length >= 1, '第一次提醒抵達');
    mock.reset();

    expect((await callCron()).status).toBe(200);
    await expectNoRequestExceptBarrier();
  });
});

/* ==================================================== ⑧ 狀態三＋一態 */

describe('GET /api/settings/line/owner-notify：狀態是查證過的事實，不是推導', () => {
  it('(a) 有名單且 LINE 回得動 → ENABLED', async () => {
    await seedRecipients([U1]);
    const state = await getState();
    expect(state.status).toBe('ENABLED');
    expect(state.recipients.map((r) => r.lineUserId)).toEqual([U1]);
    expect(state.recipients[0].displayName).toBe(NAMES[U1]);
    // 真的問過 LINE（不是有 token 就說連得上）
    expect(mock.requestsFor(INFO_PATH).length).toBeGreaterThanOrEqual(1);
  });

  it('(b) 有名單但 LINE 連線異常 → DISCONNECTED，且不謊報通知會送達', async () => {
    await seedRecipients([U1]);
    mock.respondTo(INFO_PATH, { status: 401, body: { message: 'Invalid access token' } });

    const state = await getState();
    expect(state.status).toBe('DISCONNECTED');
    expect(state.status).not.toBe('ENABLED');
    expect(state.recipients).toHaveLength(1);   // 「已綁定」與「連線正常」是兩件事
  });

  it('(c) 未設定 LINE Channel → NOT_CONFIGURED', async () => {
    await seedRecipients([U1]);
    const { error } = await admin.from('tenant_settings')
      .update({ line_channel_access_token_enc: '' }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    try {
      expect((await getState()).status).toBe('NOT_CONFIGURED');
    } finally {
      await admin.from('tenant_settings')
        .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN_A) })
        .eq('tenant_id', SHOP_A.id);
    }
  });
});

/* ==================================================== ⑨ 跨租戶（RLS） */

describe('跨租戶隔離（RLS）', () => {
  it('B 店讀不到 A 店的接收者，也不能移除 A 店的接收者', async () => {
    await seedRecipients([U1, U2]);

    const stateB = await getState(ownerB);
    expect(stateB.recipients.map((r) => r.lineUserId)).toEqual([UB]);   // 只有自己那位
    expect(stateB.recipients.map((r) => r.lineUserId)).not.toContain(U1);

    const res = await ownerB.delete(`${OWNER_NOTIFY}/recipients/${U1}`);
    expect(res.status).toBe(404);

    // A 店的名單完好無損（直查）
    expect((await dbRecipients()).map((r) => r.line_user_id)).toEqual([U1, U2]);
  });
});
