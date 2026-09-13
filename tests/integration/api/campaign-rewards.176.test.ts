/**
 * 行銷活動獎勵端到端整合測試（issue #176 第 2、3 項）
 * -----------------------------------------------------------------------------
 * ## 這一檔要證的是什麼
 *
 * `campaigns.content` 的 `couponId` / `bonusPoints` / `thresholdAmount` 從 `0005`
 * 就存得進去，但**全站沒有任何程式讀它們**：`POST /api/campaigns/:id/publish` 的
 * 完整內容是一次 `update({ status: 'PUBLISHED' })`。店家設好「滿額送 100 點」、
 * 按發布、看到成功訊息，實際什麼都不會發生。
 *
 * 單元層鎖不住這件事——那邊讀的是原始碼文字，而「文字對了」與「點數真的進了顧客
 * 帳上」是兩回事（#218 的 `0090` 就是文字全對、每次呼叫都在執行期炸）。所以本檔
 * 每一條都走**真實 API ＋ 真實資料庫**：呼叫 `POST /api/bookings/:id/complete`
 * 或打真的 webhook，然後直接查 `customers.points` / `customer_point_logs` /
 * `coupon_instances` / `campaign_reward_grants`。
 *
 * ## 前置隔離
 *
 * - 自己造顧客、預約、活動、票券，全部帶 `I176` / `itest-176` 前綴，afterAll 只刪自己的。
 *   整表 delete 會清掉別的測試檔的前置資料，那種檔案會在「別人先跑過」時神秘轉紅。
 * - 預約 `staff_id` 一律 null：`x_bookings_overlap` 只在 `staff_id is not null` 時生效，
 *   給 null 就完全避開時段重疊約束，不必為了測獎勵去編排不衝突的時段。
 * - **關掉 `tenant_settings.points.pointEarnEnabled`**：預約完成本來就會依消費金額
 *   累點（`complete/route.ts` 的既有行為）。不關掉的話，點數斷言會同時被兩個來源
 *   影響，測到的就不是「活動有沒有發」。afterAll 逐字還原。
 * - 快照並確保 `POINT_SYSTEM` / `COUPON_SYSTEM` 訂閱有效——標準種子不保證兩者都在，
 *   缺了的話活動會正確地被閘門擋下，測試紅的是「前提沒準備好」而不是功能壞了
 *   （這一點是 #5 的 TOUR_MODULE 踩過的坑）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { LineMockServer } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const CHANNEL_SECRET = 'itest-line-channel-secret-c176';
const CHANNEL_TOKEN = 'itest-line-access-token-c176';
const USER = 'Ucampaign176itest00000000000000001';
const DEFAULT_REPLY = '【itest-176】分支⑥預設回覆';

/** 本檔造的資料一律帶這個前綴，afterAll 只刪自己的 */
const TAG = 'I176';

let admin: SupabaseClient;
let api: AuthedApi;
const mock = new LineMockServer();

let pointsSnapshot: unknown = null;
let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
const featureSnapshots: Record<string, Record<string, unknown> | null> = {};

const ids = {
  customerNew: '', customerOther: '',
  couponUnlimited: '',
  campNewCustomer: '', campThreshold: '', campNoThreshold: '', campDraft: '',
  campExpired: '', campLimited: '', campOtherTenant: '',
};

/* --------------------------------------------------------------- 共用工具 */

function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

async function customerSays(text: string): Promise<string> {
  mock.reset();
  const replyToken = `rt-${Math.random().toString(36).slice(2)}`;
  const raw = JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message', replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  const replies = mock.requestsFor('/v2/bot/message/reply');
  return replies.length ? String(replies[0].body?.messages?.[0]?.text ?? '') : '';
}

/** 造一筆 PENDING 預約（staff_id null，避開 x_bookings_overlap），回傳 id */
async function seedBooking(customerId: string, finalPrice: number, seq: number): Promise<string> {
  const start = new Date(Date.UTC(2026, 4, 1, 2, 0, 0) + seq * 3600_000).toISOString();
  const end = new Date(new Date(start).getTime() + 1800_000).toISOString();
  const { data, error } = await admin.from('bookings').insert({
    tenant_id: SHOP_A.id,
    booking_no: `${TAG}-${String(seq).padStart(4, '0')}`,
    customer_id: customerId,
    service_id: SHOP_A.serviceA1,
    staff_id: null,
    start_at: start, end_at: end, duration_minutes: 30,
    price: finalPrice, final_price: finalPrice,
    status: 'PENDING',
  }).select('id').single();
  expect(error, `種子預約失敗：${error?.message}`).toBeNull();
  return data!.id as string;
}

async function completeBooking(bookingId: string): Promise<void> {
  const res = await api.post(`/api/bookings/${bookingId}/complete`, {});
  const body = await res.json().catch(() => ({}));
  expect(res.status, `complete 失敗：${JSON.stringify(body)}`).toBe(200);
}

async function pointsOf(customerId: string): Promise<number> {
  const { data } = await admin.from('customers').select('points').eq('id', customerId).single();
  return Number(data?.points ?? 0);
}

async function grantsFor(campaignId: string): Promise<any[]> {
  const { data } = await admin.from('campaign_reward_grants')
    .select('*').eq('tenant_id', SHOP_A.id).eq('campaign_id', campaignId);
  return data ?? [];
}

async function makeCampaign(
  name: string,
  content: Record<string, unknown>,
  opts: { status?: string; tenantId?: string; startAt?: string | null; endAt?: string | null } = {},
): Promise<string> {
  const { data, error } = await admin.from('campaigns').insert({
    tenant_id: opts.tenantId ?? SHOP_A.id,
    name: `${TAG} ${name}`,
    keyword: (content.keyword as string) ?? '',
    content,
    status: opts.status ?? 'PUBLISHED',
    start_at: opts.startAt ?? null,
    end_at: opts.endAt ?? null,
  }).select('id').single();
  expect(error, `種子活動失敗：${error?.message}`).toBeNull();
  return data!.id as string;
}

async function cleanupOwnRows(): Promise<void> {
  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    await admin.from('campaign_reward_grants').delete().eq('tenant_id', tenantId)
      .in('campaign_id', Object.values(ids).filter(Boolean));
    await admin.from('bookings').delete().eq('tenant_id', tenantId).like('booking_no', `${TAG}-%`);
    await admin.from('campaigns').delete().eq('tenant_id', tenantId).like('name', `${TAG} %`);
  }
  const customerIds = [ids.customerNew, ids.customerOther].filter(Boolean);
  if (customerIds.length) {
    await admin.from('coupon_instances').delete().eq('tenant_id', SHOP_A.id).in('customer_id', customerIds);
    await admin.from('customer_point_logs').delete().eq('tenant_id', SHOP_A.id).in('customer_id', customerIds);
    await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
    await admin.from('customers').delete().eq('tenant_id', SHOP_A.id).in('id', customerIds);
  }
  if (ids.couponUnlimited) {
    await admin.from('coupon_instances').delete().eq('tenant_id', SHOP_A.id).eq('coupon_id', ids.couponUnlimited);
    await admin.from('coupons').delete().eq('id', ids.couponUnlimited);
  }
}

async function ensureFeature(code: string): Promise<void> {
  const { data } = await admin.from('feature_subscriptions').select('*')
    .eq('tenant_id', SHOP_A.id).eq('code', code).maybeSingle();
  featureSnapshots[code] = (data as Record<string, unknown> | null) ?? null;
  const { error } = await admin.from('feature_subscriptions').upsert({
    tenant_id: SHOP_A.id, code, active: true, expires_at: null,
    source: 'GRANTED', cancelled_at: null,
  }, { onConflict: 'tenant_id,code' });
  expect(error).toBeNull();
}

/* -------------------------------------------------------------- 前置 / 收尾 */

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error('缺少 LINE_API_BASE：本檔需要 .env.test 設 LINE_API_BASE / LINE_DATA_API_BASE');
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();
  api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  await ensureFeature('POINT_SYSTEM');
  await ensureFeature('COUPON_SYSTEM');

  // 預約完成的既有累點會污染點數斷言——關掉它，afterAll 逐字還原
  const { data: srow } = await admin.from('tenant_settings')
    .select('points, line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  pointsSnapshot = srow?.points ?? null;
  settingsSnapshot = {
    line: srow?.line,
    line_channel_secret_enc: srow?.line_channel_secret_enc,
    line_channel_access_token_enc: srow?.line_channel_access_token_enc,
  } as typeof settingsSnapshot;

  await admin.from('tenant_settings').update({
    points: { ...((srow?.points ?? {}) as object), pointEarnEnabled: false },
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    line: {
      autoReplyEnabled: true, defaultReply: DEFAULT_REPLY,
      systemKeywordGroupsDisabled: [], campaignKeywordEnabled: true,
    },
  }).eq('tenant_id', SHOP_A.id);

  // 自己的顧客（點數從 0 起算，狀態完全可控）
  const { data: cs, error: cErr } = await admin.from('customers').insert([
    { tenant_id: SHOP_A.id, name: `${TAG} 新顧客`, points: 0 },
    { tenant_id: SHOP_A.id, name: `${TAG} 另一位`, points: 0 },
  ]).select('id');
  expect(cErr, `種子顧客失敗：${cErr?.message}`).toBeNull();
  ids.customerNew = cs![0].id;
  ids.customerOther = cs![1].id;

  /**
   * ⚠️ `coupons.discount_type` 是 **not null 且無預設**（`0004`），少了它整個
   * insert 會 23502。第一版就是這樣被 `local-isolated-a` 打回來的——我在本機用
   * 手工重建的簡化 schema 驗過 RPC，那份 schema 沒有這個欄位，於是「SQL 對了」
   * 與「種子插得進去」是兩件事。
   * 這次不一次猜一個約束（#285 的教訓）：`coupons` 的 not-null-無預設欄位只有
   * `tenant_id` / `name` / `discount_type` 三個，後續 migration（`0011`、`0080`、
   * overlay `0022`）加的欄位全部帶預設值，已逐一核對。
   */
  const { data: cp, error: cpErr } = await admin.from('coupons').insert({
    tenant_id: SHOP_A.id, name: `${TAG} 活動券`,
    discount_type: 'AMOUNT', discount_value: 100,
    total_quantity: 0, status: 'PUBLISHED',
  }).select('id').single();
  expect(cpErr, `種子票券失敗：${cpErr?.message}`).toBeNull();
  ids.couponUnlimited = cp!.id;
});

afterAll(async () => {
  await cleanupOwnRows();
  if (pointsSnapshot !== null || settingsSnapshot) {
    await admin.from('tenant_settings').update({
      points: pointsSnapshot ?? {},
      line: settingsSnapshot?.line ?? {},
      line_channel_secret_enc: settingsSnapshot?.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot?.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  for (const [code, snap] of Object.entries(featureSnapshots)) {
    if (snap) await admin.from('feature_subscriptions').upsert(snap, { onConflict: 'tenant_id,code' });
    else await admin.from('feature_subscriptions').delete().eq('tenant_id', SHOP_A.id).eq('code', code);
  }
  await mock.stop();
});

/* ========================================================================== */
/* ① 預約完成觸發：新客首購                                                    */
/* ========================================================================== */
describe('新客首購：第一筆完成的預約才發（#176 第 2 項）', () => {
  beforeEach(async () => {
    await admin.from('campaign_reward_grants').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('bookings').delete().eq('tenant_id', SHOP_A.id).like('booking_no', `${TAG}-%`);
    await admin.from('campaigns').delete().eq('tenant_id', SHOP_A.id).like('name', `${TAG} %`);
    await admin.from('customer_point_logs').delete().eq('tenant_id', SHOP_A.id).eq('customer_id', ids.customerNew);
    await admin.from('customers').update({ points: 0 }).eq('id', ids.customerNew);
    ids.campNewCustomer = await makeCampaign('新客首購', { type: 'NEW_CUSTOMER', bonusPoints: 100 });
  });

  it('第一筆預約完成 → 點數真的進帳、帳本有一筆、發放紀錄有一列', async () => {
    const booking = await seedBooking(ids.customerNew, 500, 1);
    await completeBooking(booking);

    expect(await pointsOf(ids.customerNew)).toBe(100);

    const { data: logs } = await admin.from('customer_point_logs')
      .select('delta, reason, points_after')
      .eq('tenant_id', SHOP_A.id).eq('customer_id', ids.customerNew);
    expect(logs).toHaveLength(1);
    expect(logs![0].delta).toBe(100);
    expect(logs![0].reason).toBe('CAMPAIGN_REWARD');
    expect(logs![0].points_after).toBe(100);

    const grants = await grantsFor(ids.campNewCustomer);
    expect(grants).toHaveLength(1);
    expect(grants[0].trigger_kind).toBe('BOOKING_COMPLETED');
    expect(grants[0].source_id).toBe(booking);
    expect(grants[0].bonus_points).toBe(100);
  });

  it('同一位顧客的第二筆預約完成 → **不再發第二次**（冪等）', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 500, 2));
    expect(await pointsOf(ids.customerNew)).toBe(100);

    await completeBooking(await seedBooking(ids.customerNew, 500, 3));

    // 點數不得再增加、帳本不得多一筆、發放紀錄仍是一列
    expect(await pointsOf(ids.customerNew)).toBe(100);
    const { count } = await admin.from('customer_point_logs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).eq('customer_id', ids.customerNew);
    expect(count).toBe(1);
    expect(await grantsFor(ids.campNewCustomer)).toHaveLength(1);
  });

  it('另一位顧客的第一筆預約完成 → 各自算各自的（冪等鍵含 customer_id）', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 500, 4));
    await completeBooking(await seedBooking(ids.customerOther, 500, 5));
    expect(await pointsOf(ids.customerNew)).toBe(100);
    expect(await pointsOf(ids.customerOther)).toBe(100);
    expect(await grantsFor(ids.campNewCustomer)).toHaveLength(2);
  });

  it('草稿活動不發', async () => {
    await admin.from('campaigns').update({ status: 'DRAFT' }).eq('id', ids.campNewCustomer);
    await completeBooking(await seedBooking(ids.customerNew, 500, 6));
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campNewCustomer)).toHaveLength(0);
  });

  it('活動期間已過不發', async () => {
    await admin.from('campaigns')
      .update({ end_at: new Date(Date.now() - 86400_000).toISOString() })
      .eq('id', ids.campNewCustomer);
    await completeBooking(await seedBooking(ids.customerNew, 500, 7));
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campNewCustomer)).toHaveLength(0);
  });

  it('別家店的同型活動不會被觸發（跨租戶）', async () => {
    await admin.from('campaigns').update({ status: 'DRAFT' }).eq('id', ids.campNewCustomer);
    ids.campOtherTenant = await makeCampaign('B店新客', { type: 'NEW_CUSTOMER', bonusPoints: 999 },
      { tenantId: SHOP_B.id });
    await completeBooking(await seedBooking(ids.customerNew, 500, 8));
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campOtherTenant)).toHaveLength(0);
  });
});

/* ========================================================================== */
/* ② 預約完成觸發：滿額回饋                                                    */
/* ========================================================================== */
describe('滿額回饋：金額達標才發（#176 第 2 項）', () => {
  beforeEach(async () => {
    await admin.from('campaign_reward_grants').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('bookings').delete().eq('tenant_id', SHOP_A.id).like('booking_no', `${TAG}-%`);
    await admin.from('campaigns').delete().eq('tenant_id', SHOP_A.id).like('name', `${TAG} %`);
    await admin.from('coupon_instances').delete().eq('tenant_id', SHOP_A.id).eq('coupon_id', ids.couponUnlimited);
    await admin.from('customer_point_logs').delete().eq('tenant_id', SHOP_A.id).eq('customer_id', ids.customerNew);
    await admin.from('customers').update({ points: 0 }).eq('id', ids.customerNew);
    ids.campThreshold = await makeCampaign('滿額回饋', {
      type: 'SPENDING_THRESHOLD', thresholdAmount: 1000, bonusPoints: 50,
      couponId: ids.couponUnlimited,
    });
  });

  it('未達門檻 → 完全不發', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 999, 11));
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campThreshold)).toHaveLength(0);
  });

  it('剛好達門檻 → 發（邊界是 >=，不是 >）', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 1000, 12));
    expect(await pointsOf(ids.customerNew)).toBe(50);
    expect(await grantsFor(ids.campThreshold)).toHaveLength(1);
  });

  it('達門檻時票券也真的發到那位顧客身上，且發放紀錄指得回去', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 2000, 13));

    const { data: insts } = await admin.from('coupon_instances')
      .select('id, customer_id, coupon_id, code')
      .eq('tenant_id', SHOP_A.id).eq('coupon_id', ids.couponUnlimited);
    expect(insts).toHaveLength(1);
    expect(insts![0].customer_id).toBe(ids.customerNew);
    expect(String(insts![0].code)).toHaveLength(8);

    const grants = await grantsFor(ids.campThreshold);
    expect(grants).toHaveLength(1);
    expect(grants[0].coupon_instance_id).toBe(insts![0].id);
  });

  it('沒填門檻的滿額活動 → 不發（「沒填」不等於 0）', async () => {
    await admin.from('campaigns').update({ status: 'DRAFT' }).eq('id', ids.campThreshold);
    ids.campNoThreshold = await makeCampaign('沒填門檻', {
      type: 'SPENDING_THRESHOLD', bonusPoints: 50,
    });
    await completeBooking(await seedBooking(ids.customerNew, 5000, 14));
    // 把「沒填門檻」當成 0，會讓一個空白活動對每一筆完成的預約發點數
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campNoThreshold)).toHaveLength(0);
  });

  it('第二筆同樣達標的預約 → 不重複發（每位顧客每活動一次）', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 2000, 15));
    expect(await pointsOf(ids.customerNew)).toBe(50);
    await completeBooking(await seedBooking(ids.customerNew, 3000, 16));
    expect(await pointsOf(ids.customerNew)).toBe(50);
    expect(await grantsFor(ids.campThreshold)).toHaveLength(1);
    const { data: insts } = await admin.from('coupon_instances')
      .select('id').eq('tenant_id', SHOP_A.id).eq('coupon_id', ids.couponUnlimited);
    expect(insts).toHaveLength(1);
  });
});

/* ========================================================================== */
/* ③ LINE 關鍵字領取：限時優惠                                                 */
/* ========================================================================== */
describe('限時優惠：顧客在 LINE 打關鍵字領取（#176 第 2 項）', () => {
  const KEYWORD = 'itest176限時';

  beforeEach(async () => {
    await admin.from('campaign_reward_grants').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('campaigns').delete().eq('tenant_id', SHOP_A.id).like('name', `${TAG} %`);
    await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
    await admin.from('customer_point_logs').delete().eq('tenant_id', SHOP_A.id).eq('customer_id', ids.customerNew);
    await admin.from('customers').update({ points: 0 }).eq('id', ids.customerNew);
    await admin.from('line_users').upsert({
      tenant_id: SHOP_A.id, line_user_id: USER, display_name: `${TAG} 顧客`,
      followed: true, customer_id: ids.customerNew,
    }, { onConflict: 'tenant_id,line_user_id' });
    ids.campLimited = await makeCampaign('限時優惠', {
      type: 'LIMITED_TIME', keyword: KEYWORD, text: '限時 9 折，只到月底！', bonusPoints: 30,
    });
  });

  it('打關鍵字 → 收到活動內容**並且**點數真的進帳', async () => {
    const reply = await customerSays(KEYWORD);
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain('限時 9 折');
    expect(reply).toContain('30');

    expect(await pointsOf(ids.customerNew)).toBe(30);
    expect(await grantsFor(ids.campLimited)).toHaveLength(1);
    expect((await grantsFor(ids.campLimited))[0].trigger_kind).toBe('KEYWORD_CLAIM');
  });

  it('再打一次 → 明說已領取過，且點數不再增加', async () => {
    await customerSays(KEYWORD);
    const second = await customerSays(KEYWORD);

    // 不說出來的話，顧客會以為又領到一次
    expect(second).toContain('已領取過');
    expect(await pointsOf(ids.customerNew)).toBe(30);
    expect(await grantsFor(ids.campLimited)).toHaveLength(1);
  });

  it('LINE 未綁定顧客 → 照樣回活動內容，但不發也不宣稱發了', async () => {
    await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
    const reply = await customerSays(KEYWORD);

    expect(reply).toContain('限時 9 折');
    expect(reply).not.toContain('已為您登記');
    expect(await grantsFor(ids.campLimited)).toHaveLength(0);
  });

  it('活動期間已過 → 關鍵字仍回內容，但不發獎勵', async () => {
    await admin.from('campaigns')
      .update({ end_at: new Date(Date.now() - 86400_000).toISOString() })
      .eq('id', ids.campLimited);
    const reply = await customerSays(KEYWORD);
    expect(reply).toContain('限時 9 折');
    expect(reply).not.toContain('已為您登記');
    expect(await grantsFor(ids.campLimited)).toHaveLength(0);
  });

  it('預約完成不會觸發限時優惠（類型與觸發來源必須配對）', async () => {
    await completeBooking(await seedBooking(ids.customerNew, 5000, 21));
    expect(await pointsOf(ids.customerNew)).toBe(0);
    expect(await grantsFor(ids.campLimited)).toHaveLength(0);
  });
});
