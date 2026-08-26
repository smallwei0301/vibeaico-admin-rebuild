/**
 * 行銷推播端點整合測試 —— issue #7 (乙)「marketing service 包裝＋接線＋整合案例
 * （send 後 mock LINE 收 multicast、額度扣減）」。
 *
 * 契約出處：04 分冊 §B-5（marketing 端點）、06 分冊 §2（推播額度；reply 不佔額度、
 * push/multicast 才佔）。實作 src/app/api/marketing/pushes*、src/server/line.ts。
 * 前端鏈路：src/app/tenant/marketing/page.tsx → src/services/marketing.ts → 本檔端點。
 *
 * 鏈路：本測試 process 在 **固定 port（LINE_API_BASE 指的 4123）** 起
 * tests/helpers/line-mock.ts 的假 LINE server；global-setup 起的 next dev 打 LINE API
 * 時就落到 mock。beforeAll 以 service role + encryptSecret() 把測試憑證寫進 SHOP_A 的
 * tenant_settings（seed 沒有種 LINE 憑證），afterAll 還原快照。
 *
 * ⚠️ 反向斷言（「額度不足時一個 LINE 請求都不該有」）用**障壁**，不是固定秒數等待
 * （14 分冊 §6.16-a：實測 1 秒窗口會讓紅燈落在錯的案例上）。障壁的作法是：在同一個
 * mock 上，讓 B 店做一件**必定會打到 LINE**的事，等那一則抵達，再斷言
 * `mock.requests` 只有那一則。這樣「沒有請求」是被一個已抵達的訊號界定出來的，
 * 不是「等了一下沒看到」。
 *
 * 基線紀律：本檔造出的 marketing_pushes / customers / line_users 在 afterAll 全刪，
 * push_quota_usage 與 tenant_settings 還原快照。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const MULTICAST_PATH = '/v2/bot/message/multicast';
const PUSH_PATH = '/v2/bot/message/push';

const CHANNEL_SECRET_A = 'itest-mk07-secret-a';
const CHANNEL_TOKEN_A = 'itest-mk07-token-a';
const CHANNEL_SECRET_B = 'itest-mk07-secret-b';
const CHANNEL_TOKEN_B = 'itest-mk07-token-b';

/**
 * SHOP_A 的種子含 EXTRA_PUSH 訂閱 → 推播上限 **700**，不是免費方案的 200
 * （09 分冊 §5、src/server/line.ts consumePushQuota）。
 * ⚠️ 一開始這裡寫 199 當「只剩 1 則」，結果 199+2 遠低於 700，端點照樣成功——
 * 那條反向斷言等於什麼都沒驗到。上限是查 seed.mjs 的 tenant_features 得到的，
 * 不是推測的。
 */
const QUOTA_LIMIT = 700;

/** 本檔專用 LINE user id（避免與其他檔互踩） */
const U1 = 'Umk07itest000000000000000000000001';
const U2 = 'Umk07itest000000000000000000000002';
/** 已封鎖（followed=false）—— 不該收到推播 */
const U_BLOCKED = 'Umk07itest000000000000000000000003';
/** 障壁用（B 店） */
const U_BARRIER = 'Umk07itest000000000000000000000009';

type SettingsSnapshot = {
  line: unknown;
  line_channel_secret_enc: string | null;
  line_channel_access_token_enc: string | null;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();
const settingsSnapshot: Record<string, SettingsSnapshot | null> = {};
const quotaSnapshot: Record<string, number | null> = {};
/** 本檔建立的推播 id（afterAll 只刪自己的） */
const createdPushIds: string[] = [];
let customerU2: string;
let customerBarrier: string;

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function quotaUsed(tenantId: string = SHOP_A.id): Promise<number> {
  const { data, error } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', tenantId).eq('month', taipeiMonthKey()).maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number, tenantId: string = SHOP_A.id): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: tenantId, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

/** service role 直查推播列（斷言用的期望值一律直查現有資料，不信端點自己的回應） */
async function pushRow(id: string) {
  const { data, error } = await admin.from('marketing_pushes')
    .select('id, title, status, sent_count, sent_at, scheduled_at, content, audience')
    .eq('id', id).maybeSingle();
  expect(error).toBeNull();
  return data as {
    id: string; title: string; status: string; sent_count: number | null;
    sent_at: string | null; scheduled_at: string | null;
    content: Record<string, unknown>; audience: Record<string, unknown>;
  } | null;
}

/** 建一筆推播（走端點，順便當作「建立」的鏈路證據），回 id */
async function createPush(body: Record<string, unknown>): Promise<string> {
  const res = await ownerA.post('/api/marketing/pushes', body);
  expect(res.status).toBe(200);
  const { data } = await res.json();
  createdPushIds.push(data.id);
  return data.id as string;
}

/**
 * 障壁：讓 B 店做一件必定打到 LINE 的事，等它抵達，然後斷言 `mock.requests`
 * **只有**那一則。用途是把「A 店這次操作一個 LINE 請求都沒發」變成可證的事，
 * 而不是「等一秒沒看到」（14 分冊 §6.16-a）。
 *
 * 斷言對象刻意是整個 requests 陣列而不是 `requestsFor(MULTICAST_PATH)`：
 * 如果實作哪天改用 /push 或多打了一支 /v2/bot/info，只看 multicast 會漏掉。
 */
async function expectNoLineRequestExceptBarrier(): Promise<void> {
  const res = await ownerB.post('/api/chat/messages', {
    lineUserId: U_BARRIER, text: '#7乙 障壁訊息（B 店）',
  });
  expect(res.status).toBe(200);

  expect(mock.requests.map((r) => `${r.method} ${r.path}`))
    .toEqual([`POST ${PUSH_PATH}`]);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 ' +
      'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts ' +
      '打到 tests/helpers/line-mock.ts 起的本地假 LINE server。',
    );
  }

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
      .select('line, line_channel_secret_enc, line_channel_access_token_enc')
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

  // ---- A 店：兩位追蹤中的 LINE 好友 + 一位已封鎖 ----
  const { error: e2 } = await admin.from('line_users').insert([
    { tenant_id: SHOP_A.id, line_user_id: U1, display_name: '#7乙 好友1', followed: true },
    { tenant_id: SHOP_A.id, line_user_id: U2, display_name: '#7乙 好友2', followed: true },
    { tenant_id: SHOP_A.id, line_user_id: U_BLOCKED, display_name: '#7乙 已封鎖', followed: false },
  ]);
  expect(e2).toBeNull();

  // U2 對應的顧客帶標籤，驗 TAG 受眾解析
  customerU2 = randomUUID();
  const { error: e3 } = await admin.from('customers').insert({
    id: customerU2, tenant_id: SHOP_A.id, name: '#7乙 標籤顧客',
    phone: '0900071002', line_user_id: U2, tags: ['#7乙熟客'],
  });
  expect(e3).toBeNull();

  // ---- B 店障壁：一位追蹤中的好友（整檔固定，案例期間不改 → 障壁沒有競態）----
  const { error: e4 } = await admin.from('line_users').insert({
    tenant_id: SHOP_B.id, line_user_id: U_BARRIER, display_name: '#7乙 障壁好友', followed: true,
  });
  expect(e4).toBeNull();
  customerBarrier = randomUUID();
  const { error: e5 } = await admin.from('customers').insert({
    id: customerBarrier, tenant_id: SHOP_B.id, name: '#7乙 障壁顧客（B 店）',
    phone: '0900071009', line_user_id: U_BARRIER,
  });
  expect(e5).toBeNull();
  await setQuotaUsed(0, SHOP_B.id);
});

afterAll(async () => {
  for (const id of createdPushIds) await admin.from('marketing_pushes').delete().eq('id', id);
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_B.id).eq('line_user_id', U_BARRIER);
  await admin.from('customers').delete().eq('id', customerU2);
  await admin.from('customers').delete().eq('id', customerBarrier);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id)
    .in('line_user_id', [U1, U2, U_BLOCKED]);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_B.id).eq('line_user_id', U_BARRIER);

  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    const snap = settingsSnapshot[tenantId];
    if (snap) {
      await admin.from('tenant_settings').update({
        line: snap.line,
        line_channel_secret_enc: snap.line_channel_secret_enc,
        line_channel_access_token_enc: snap.line_channel_access_token_enc,
      }).eq('tenant_id', tenantId);
    }
    const q = quotaSnapshot[tenantId];
    if (q === null) {
      await admin.from('push_quota_usage').delete()
        .eq('tenant_id', tenantId).eq('month', taipeiMonthKey());
    } else {
      await setQuotaUsed(q, tenantId);
    }
  }
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

/* ========================================================================== */

describe('marketing pushes：建立 / 編輯 / 刪除（頁面的「建立」「刪除」按鈕鏈路）', () => {
  it('建立草稿 → GET /api/marketing/pushes 讀得到，且 DB 的 status 是 DRAFT', async () => {
    const id = await createPush({
      title: '#7乙 草稿推播', content: '草稿內容', note: '內部備註', targetType: 'ALL',
    });

    const row = await pushRow(id);
    expect(row?.status).toBe('DRAFT');
    expect(row?.content.text).toBe('草稿內容');
    expect(row?.content.note).toBe('內部備註');

    const res = await ownerA.get('/api/marketing/pushes');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const found = data.find((p: { id: string }) => p.id === id);
    expect(found).toBeTruthy();
    expect(found.status).toBe('DRAFT');
    expect(found.content).toBe('草稿內容');
    expect(found.sentCount).toBe(0);
  });

  it('帶排程時間建立 → status 是 SCHEDULED，scheduled_at 落庫', async () => {
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const id = await createPush({
      title: '#7乙 排程推播', content: '排程內容', targetType: 'ALL', scheduledAt: when,
    });

    const row = await pushRow(id);
    expect(row?.status).toBe('SCHEDULED');
    expect(row?.scheduled_at).toBeTruthy();
    expect(Date.parse(row!.scheduled_at!)).toBe(Date.parse(when));
  });

  it('編輯草稿 → 標題與受眾真的改到 DB（不是只回 200）', async () => {
    const id = await createPush({ title: '#7乙 待編輯', content: '舊內容', targetType: 'ALL' });

    const res = await ownerA.put(`/api/marketing/pushes/${id}`, {
      title: '#7乙 已編輯', content: '新內容', targetType: 'TAG',
      targetValue: '#7乙熟客', targetLabel: '#7乙熟客',
    });
    expect(res.status).toBe(200);

    const row = await pushRow(id);
    expect(row?.title).toBe('#7乙 已編輯');
    expect(row?.content.text).toBe('新內容');
    expect(row?.audience.type).toBe('TAG');
    expect(row?.audience.value).toBe('#7乙熟客');
  });

  it('刪除草稿 → DB 真的沒有這一列（不是只回 200）', async () => {
    const id = await createPush({ title: '#7乙 待刪除', content: 'x', targetType: 'ALL' });
    expect(await pushRow(id)).not.toBeNull();

    const res = await ownerA.delete(`/api/marketing/pushes/${id}`);
    expect(res.status).toBe(200);
    expect(await pushRow(id)).toBeNull();
  });

  it('別家店的推播 id → 404（跨租戶隔離）', async () => {
    const id = await createPush({ title: '#7乙 A 店的', content: 'x', targetType: 'ALL' });
    const res = await ownerB.delete(`/api/marketing/pushes/${id}`);
    expect(res.status).toBe(404);
    // 沒被刪掉才算真的擋住
    expect(await pushRow(id)).not.toBeNull();
  });
});

describe('marketing pushes：取消（頁面的「取消推播」按鈕鏈路）', () => {
  it('SCHEDULED → cancel 後 DB 的 status 是 CANCELLED', async () => {
    const id = await createPush({
      title: '#7乙 待取消', content: 'x', targetType: 'ALL',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect((await pushRow(id))?.status).toBe('SCHEDULED');

    const res = await ownerA.post(`/api/marketing/pushes/${id}/cancel`);
    expect(res.status).toBe(200);
    expect((await pushRow(id))?.status).toBe('CANCELLED');
  });

  it('DRAFT（沒有排程）→ cancel 回 409，狀態保持 DRAFT 不變', async () => {
    const id = await createPush({ title: '#7乙 草稿不可取消', content: 'x', targetType: 'ALL' });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/cancel`);
    expect(res.status).toBe(409);
    expect((await pushRow(id))?.status).toBe('DRAFT');
  });
});

describe('marketing pushes：立即發送（頁面「立即發送」按鈕的真正副作用）', () => {
  it('ALL 受眾 → mock LINE 收到 multicast，收件人只有 followed=true 的兩位，額度 -2', async () => {
    await setQuotaUsed(0);
    const id = await createPush({
      title: '#7乙 全體發送', content: '全體推播內容', targetType: 'ALL',
    });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sentCount).toBe(2);

    const calls = mock.requestsFor(MULTICAST_PATH);
    expect(calls).toHaveLength(1);
    expect([...(calls[0].body.to as string[])].sort()).toEqual([U1, U2].sort());
    // 已封鎖的好友不該在收件名單裡（不是「應該不會」，是名單裡真的沒有）
    expect(calls[0].body.to).not.toContain(U_BLOCKED);
    expect(calls[0].body.messages).toEqual([{ type: 'text', text: '全體推播內容' }]);

    // 額度按人數扣（06 分冊 §2：multicast 佔額度）
    expect(await quotaUsed()).toBe(2);

    // DB 狀態與 sent_count 是後端寫的，不是回應自己說的
    const row = await pushRow(id);
    expect(row?.status).toBe('SENT');
    expect(row?.sent_count).toBe(2);
    expect(row?.sent_at).toBeTruthy();
  });

  it('TAG 受眾 → 只送給帶該標籤且已綁 LINE 的那一位，額度 -1', async () => {
    await setQuotaUsed(0);
    const id = await createPush({
      title: '#7乙 標籤發送', content: '標籤推播內容',
      targetType: 'TAG', targetValue: '#7乙熟客', targetLabel: '#7乙熟客',
    });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.sentCount).toBe(1);

    const calls = mock.requestsFor(MULTICAST_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.to).toEqual([U2]);
    expect(await quotaUsed()).toBe(1);
  });

  it('帶圖片 → multicast 同時送出 text 與 image（外部網址時 preview 用原圖）', async () => {
    await setQuotaUsed(0);
    const imageUrl = 'https://example.com/7b-marketing.jpg';
    const id = await createPush({
      title: '#7乙 圖片發送', content: '圖片推播內容', imageUrl, targetType: 'ALL',
    });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(200);

    const calls = mock.requestsFor(MULTICAST_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages).toEqual([
      { type: 'text', text: '圖片推播內容' },
      { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
    ]);
  });

  it('額度只剩 1 但要送 2 人 → 409，狀態還原 DRAFT、額度不動，且整個 mock 一個請求都沒收到', async () => {
    // 上限 700（SHOP_A 有 EXTRA_PUSH）；用掉 699 → 只剩 1 則，而這筆要送 2 人
    await setQuotaUsed(QUOTA_LIMIT - 1);
    const id = await createPush({
      title: '#7乙 額度不足', content: '不該送出的內容', targetType: 'ALL',
    });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(409);

    // 還原成發送前的狀態，不是卡在 SENDING
    const row = await pushRow(id);
    expect(row?.status).toBe('DRAFT');
    expect(row?.sent_at).toBeNull();
    // 額度一則都沒被吃掉
    expect(await quotaUsed()).toBe(QUOTA_LIMIT - 1);

    // ⚠️ 障壁而非固定秒數：B 店送一則必定會打到 LINE 的訊息，等它抵達之後
    // 斷言整個 mock 就只有那一則——A 店這次發送真的一個請求都沒發出去。
    await expectNoLineRequestExceptBarrier();
  });

  it('沒有任何符合條件的收件人 → 409，狀態還原、額度不動、零 LINE 請求', async () => {
    await setQuotaUsed(0);
    const id = await createPush({
      title: '#7乙 無收件人', content: '不該送出的內容',
      targetType: 'TAG', targetValue: '#7乙這個標籤沒有人', targetLabel: 'none',
    });

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(409);
    expect((await pushRow(id))?.status).toBe('DRAFT');
    expect(await quotaUsed()).toBe(0);
    await expectNoLineRequestExceptBarrier();
  });

  it('已發送（SENT）的推播不可刪除 → 409，且 DB 那一列還在（保留歷史）', async () => {
    await setQuotaUsed(0);
    const id = await createPush({ title: '#7乙 已送出', content: 'x', targetType: 'ALL' });
    expect((await ownerA.post(`/api/marketing/pushes/${id}/send`)).status).toBe(200);
    expect((await pushRow(id))?.status).toBe('SENT');

    const res = await ownerA.delete(`/api/marketing/pushes/${id}`);
    expect(res.status).toBe(409);
    expect(await pushRow(id)).not.toBeNull();
  });

  it('SENT 之後再送一次 → 409，且不會重複打 LINE（防連點重送）', async () => {
    await setQuotaUsed(0);
    const id = await createPush({ title: '#7乙 重送', content: 'x', targetType: 'ALL' });
    expect((await ownerA.post(`/api/marketing/pushes/${id}/send`)).status).toBe(200);
    expect(mock.requestsFor(MULTICAST_PATH)).toHaveLength(1);

    const res = await ownerA.post(`/api/marketing/pushes/${id}/send`);
    expect(res.status).toBe(409);
    // 第二次沒有再打一次 LINE
    expect(mock.requestsFor(MULTICAST_PATH)).toHaveLength(1);
    expect(await quotaUsed()).toBe(2);
  });
});
