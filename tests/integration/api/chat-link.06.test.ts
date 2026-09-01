/**
 * 雙向收發鏈路整合測試 — 12 分冊 §「Phase 6（LINE）」的「雙向收發鏈路（04 §B-5.1）」：
 *   「webhook 收到訊息 → GET /api/chat/messages?after= 拉得到該筆；
 *    POST /api/chat/messages → mock LINE 收到 push、DB 有 OUT 訊息、推播額度 -1；
 *    額度用完時該端點回 409 且不呼叫 LINE API」
 * 外加 GET /api/chat/conversations 的未讀數/最後訊息與 read 後歸零。
 * 實作：src/app/api/chat/messages/route.ts、src/app/api/chat/conversations/route.ts、
 * src/app/api/chat/messages/[id]/read/route.ts、src/server/line.ts consumePushQuota。
 *
 * 鏈路與前置資料手法同 line-webhook.06.test.ts（mock LINE 綁 LINE_API_BASE 的
 * 固定 port 4123；SHOP_A 憑證由 beforeAll 以 encryptSecret 寫入、afterAll 還原）。
 *
 * 額度上限的自行決策（任務原文寫「admin 直接 upsert used=200」）：
 * seed 給 SHOP_A 全部 18 個付費碼 GRANTED，含 EXTRA_PUSH → consumePushQuota 的
 * 上限是 700 不是 200（09 §5：isFeatureActive(t,'EXTRA_PUSH') ? 700 : 200）。
 * upsert used=200 根本塞不滿 → 改為先用與 features.ts 相同的規則現算出「該店
 * 當下的實際上限」，upsert used=上限，才真的觸發 409；測後還原原值。
 *
 * 基線紀律：afterAll 刪掉本檔的 line_users / chat_messages、還原
 * push_quota_usage 當月列（原本不存在就刪掉）、還原 tenant_settings 快照；
 * 不碰 SHOP_A 點數交易。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer, MOCK_PROFILE_NAME_PREFIX } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const CHANNEL_SECRET = 'itest-line-channel-secret-a06-chat';
const CHANNEL_TOKEN = 'itest-line-access-token-a06-chat';

/** 本檔專用 LINE user id（與 line-webhook.06 檔分開，避免互踩） */
const USER_CHAT = 'Uchatlink06itest0000000000000000001';

const IN_TEXT_1 = 'chat-link 測試第一句（顧客傳入）';
const IN_TEXT_2 = 'chat-link 測試第二句（顧客傳入）';
const OUT_TEXT = '您好，我們收到您的訊息了（後台回覆）';

function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** 以正確簽章 POST webhook（顧客端「傳入」半邊的入口） */
async function postWebhook(payload: unknown): Promise<Response> {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(CHANNEL_SECRET, raw) },
    body: raw,
  });
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  return res;
}

function textMessageEvent(text: string, replyToken: string) {
  return {
    type: 'message',
    replyToken,
    source: { type: 'user', userId: USER_CHAT },
    message: { id: `m-${replyToken}`, type: 'text', text },
  };
}

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

/** beforeAll 時當月 push_quota_usage 是否已有列／其 used 值（afterAll 還原用） */
let quotaRowExistedAtStart = false;
let quotaUsedAtStart = 0;

async function quotaUsed(): Promise<number> {
  const { data, error } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await admin
    .from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used }, { onConflict: 'tenant_id,month' });
  expect(error).toBeNull();
}

/** 與 src/server/features.ts isFeatureActive 同一條規則，現算 SHOP_A 的推播上限 */
async function currentPushQuotaLimit(): Promise<number> {
  const { data, error } = await admin
    .from('feature_subscriptions')
    .select('active, expires_at')
    .eq('tenant_id', SHOP_A.id)
    .eq('code', 'EXTRA_PUSH')
    .maybeSingle();
  expect(error).toBeNull();
  const row = data as { active: boolean; expires_at: string | null } | null;
  const active = !!row?.active && (!row.expires_at || new Date(row.expires_at) > new Date());
  return active ? 700 : 200;
}

async function outMessages() {
  const { data, error } = await admin
    .from('chat_messages')
    .select('id, direction, content')
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', USER_CHAT)
    .eq('direction', 'OUT');
  expect(error).toBeNull();
  return (data ?? []) as { id: string; content: any }[];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：Phase 6 整合測試需要主導者在 .env.test（或 global-setup 的 ' +
        'spawn env）加 LINE_API_BASE=http://localhost:4123 與 ' +
        'LINE_DATA_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts ' +
        '打到 tests/helpers/line-mock.ts 起的本地假 LINE server。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  await mock.start();

  // SHOP_A：寫入測試 LINE 憑證（快照還原，同 line-webhook.06）
  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
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

  // push_quota_usage 當月基線快照
  const { data: q, error: e2 } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(e2).toBeNull();
  quotaRowExistedAtStart = q != null;
  quotaUsedAtStart = (q as { used: number } | null)?.used ?? 0;

  // 顧客加入好友（webhook follow）→ line_users followed=true，鏈路從真入口建立
  const res = await postWebhook({
    events: [{ type: 'follow', replyToken: 'rt-cl-follow', source: { type: 'user', userId: USER_CHAT } }],
  });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_CHAT);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_CHAT);

  // push_quota_usage 還原：原本沒有列就整列刪掉；有列就寫回原 used
  if (quotaRowExistedAtStart) {
    await setQuotaUsed(quotaUsedAtStart);
  } else {
    await admin
      .from('push_quota_usage')
      .delete()
      .eq('tenant_id', SHOP_A.id)
      .eq('month', taipeiMonthKey());
  }

  if (settingsSnapshot) {
    await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

describe('傳入半邊：webhook IN → GET /api/chat/messages?after（04 §B-5.1）', () => {
  /** 第一句的 chat_messages id —— 後面 ?after= 的錨點 */
  let anchorId = '';

  it('webhook 收第一句 → DB 有 IN 訊息（後台聊天頁的資料來源）', async () => {
    const res = await postWebhook({ events: [textMessageEvent(IN_TEXT_1, 'rt-cl-in-1')] });
    expect(res.status).toBe(200);

    const { data, error } = await admin
      .from('chat_messages')
      .select('id, direction, message_type, content')
      .eq('tenant_id', SHOP_A.id)
      .eq('line_user_id', USER_CHAT)
      .eq('direction', 'IN');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].message_type).toBe('text');
    expect(data![0].content?.text).toBe(IN_TEXT_1);
    anchorId = data![0].id as string;
  });

  it('webhook 收第二句 → GET ?after=<第一句 id> 恰好拉到第二句', async () => {
    const res = await postWebhook({ events: [textMessageEvent(IN_TEXT_2, 'rt-cl-in-2')] });
    expect(res.status).toBe(200);

    const poll = await ownerA.get(
      `/api/chat/messages?lineUserId=${encodeURIComponent(USER_CHAT)}&after=${anchorId}`,
    );
    expect(poll.status).toBe(200);
    const body = (await poll.json()) as Envelope<
      { id: string; direction: string; text: string; lineUserId: string }[]
    >;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data![0].direction).toBe('IN');
    expect(body.data![0].text).toBe(IN_TEXT_2);
    expect(body.data![0].lineUserId).toBe(USER_CHAT);
    expect(body.data![0].id).not.toBe(anchorId);
  });
});

describe('傳出半邊：POST /api/chat/messages → push + OUT + 額度（04 §B-5.1、06 §2）', () => {
  it('POST → mock LINE 收到 push、DB 有 OUT 訊息、push_quota_usage 本月 used +1', async () => {
    mock.reset();
    const usedBefore = await quotaUsed();

    const res = await ownerA.post('/api/chat/messages', { lineUserId: USER_CHAT, text: OUT_TEXT });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ direction: string; text: string; lineUserId: string }>;
    expect(body.success).toBe(true);
    expect(body.data!.direction).toBe('OUT');
    expect(body.data!.text).toBe(OUT_TEXT);

    // mock 收到恰一筆 push：to = 該顧客、內容 = 後台輸入的文字、帶解密後 token
    const pushes = mock.requestsFor('/v2/bot/message/push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].method).toBe('POST');
    expect(pushes[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(pushes[0].body.to).toBe(USER_CHAT);
    expect(pushes[0].body.messages).toEqual([{ type: 'text', text: OUT_TEXT }]);

    // DB 有 OUT 訊息
    const outs = await outMessages();
    expect(outs).toHaveLength(1);
    expect(outs[0].content?.text).toBe(OUT_TEXT);

    // 推播額度 used +1（taipeiCurrentMonthKey 的當月列）
    expect(await quotaUsed()).toBe(usedBefore + 1);
  });

  it('額度用完（used=上限）→ 409、mock LINE 沒收到 push、DB 無新 OUT；測後還原 quota', async () => {
    const usedBefore = await quotaUsed();
    const outsBefore = (await outMessages()).length;
    const limit = await currentPushQuotaLimit(); // seed 有 EXTRA_PUSH GRANTED → 700（見檔頭決策）
    await setQuotaUsed(limit);

    mock.reset();
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_CHAT,
      text: '這句不該被送出（額度已滿）',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Envelope;
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_003');
    expect(body.message).toBe('本月推播額度已用完');

    // 不呼叫 LINE API（12 分冊明定），DB 也沒有新 OUT 訊息
    expect(mock.requestsFor('/v2/bot/message/push')).toHaveLength(0);
    expect(mock.requests).toHaveLength(0);
    expect((await outMessages()).length).toBe(outsBefore);

    // 測後還原 quota 到本案例前的值（後面的 conversations 案例不受影響）
    await setQuotaUsed(usedBefore);
    expect(await quotaUsed()).toBe(usedBefore);
  });
});

describe('GET /api/chat/conversations — 未讀數與最後訊息；read 後歸零（04 §B-5）', () => {
  it('未讀 = 2 筆 IN、最後訊息 = 最新的 OUT 回覆、displayName 來自 mock profile', async () => {
    const res = await ownerA.get('/api/chat/conversations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<
      {
        lineUserId: string;
        displayName: string;
        unread: number;
        lastMessage: string;
        lastMessageAt: string | null;
        lastMessageType: string;
      }[]
    >;
    expect(body.success).toBe(true);
    const conv = body.data!.find((c) => c.lineUserId === USER_CHAT);
    expect(conv).toBeTruthy();
    expect(conv!.unread).toBe(2); // IN_TEXT_1 + IN_TEXT_2 皆未讀（OUT 不算未讀）
    expect(conv!.lastMessage).toBe(OUT_TEXT); // 時間序最新的一筆是後台的 OUT 回覆
    expect(conv!.lastMessageType).toBe('TEXT');
    expect(conv!.lastMessageAt).not.toBeNull();
    expect(conv!.displayName).toBe(`${MOCK_PROFILE_NAME_PREFIX}${USER_CHAT.slice(-4)}`);
  });

  it('逐筆 read 未讀 IN 訊息 → 未讀歸零', async () => {
    const { data: unreadRows, error } = await admin
      .from('chat_messages')
      .select('id')
      .eq('tenant_id', SHOP_A.id)
      .eq('line_user_id', USER_CHAT)
      .eq('direction', 'IN')
      .is('read_at', null);
    expect(error).toBeNull();
    expect(unreadRows).toHaveLength(2);

    for (const row of unreadRows!) {
      const res = await ownerA.post(`/api/chat/messages/${row.id}/read`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Envelope).success).toBe(true);
    }

    const res = await ownerA.get('/api/chat/conversations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<{ lineUserId: string; unread: number }[]>;
    const conv = body.data!.find((c) => c.lineUserId === USER_CHAT);
    expect(conv).toBeTruthy();
    expect(conv!.unread).toBe(0);
  });
});
