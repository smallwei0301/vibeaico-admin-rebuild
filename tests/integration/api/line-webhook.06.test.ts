/**
 * LINE webhook 整合測試 — 12 分冊 §「Phase 6（LINE）— 不打真 LINE API」：
 *   「驗 webhook POST（含正確簽章）→ line_users upsert、chat_messages 寫入、
 *    reply 被打到 mock；壞簽章 401；處理中丟錯仍回 200」
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §3（webhook 驗簽/永遠 200）、
 * §2（reply 不佔推播額度）；實作 src/app/api/line/webhook/[shopCode]/route.ts、
 * src/server/line-events.ts。
 *
 * 鏈路：本測試 process 在 **固定 port（LINE_API_BASE 指的 4123）** 起
 * tests/helpers/line-mock.ts 的假 LINE server；global-setup 起的 next dev
 * （spawn env spread process.env，.env.test 已設 LINE_API_BASE/LINE_DATA_API_BASE
 * =http://localhost:4123）打 LINE API 時就落到 mock —— beforeAll 先驗這兩個
 * env 存在，缺了會用明確訊息紅燈（需要主導者在 .env.test 補上）。
 *
 * 前置資料（seed.mjs **沒有**種 LINE 憑證——line_channel_secret_enc 空字串）：
 * beforeAll 以 service role + src/server/crypto 的 encryptSecret()（跟 server
 * 同一把 .env.test SETTINGS_ENCRYPTION_KEY）把測試憑證寫進 SHOP_A 的
 * tenant_settings；afterAll 還原快照。SHOP_B 刻意不設 → 驗「未設定 LINE 憑證
 * 的店 webhook 回 404」（route 的實作決策：無 secret 無從驗簽，回 5xx 只會讓
 * LINE 無限重送）。
 *
 * issue #31：驗簽後 route 立即回 200，事件處理在 after() 執行；一般案例用
 * drainWebhook() 取得確定性的完成訊號，只有先後順序案例使用 raw POST。
 * 不用 sleep 猜測背景工作何時完成。
 *
 * 基線紀律：afterAll 刪除本檔造出的 keyword_replies（只刪自己插的 id）、
 * line_users、chat_messages（含畸形事件寫入的 line_user_id='' 列），
 * tenant_settings 還原快照；不動 SHOP_A 點數交易。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import {
  LineMockServer,
  MOCK_PROFILE_NAME_PREFIX,
  MOCK_PROFILE_PICTURE_URL,
} from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-a06';
const CHANNEL_TOKEN = 'itest-line-access-token-a06';

/** 本檔專用 LINE user id（避免跟 chat-link.06 檔互踩） */
const USER_WEBHOOK = 'Uwebhook06itest0000000000000000001';

const KEYWORD = '整合測試優惠';
const KEYWORD_REPLY_TEXT = '本月優惠：整合測試專屬九折';
const KEYWORD_INACTIVE = '停用關鍵字';

/** LINE 官方簽章規則（與 route.ts 驗簽演算法互為鏡像，單元測試另有矩陣） */
function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** POST 一段指定 raw body；未給簽章則用正確 secret 算，不等待背景處理。 */
async function postWebhookRawBody(
  shopCode: string,
  raw: string,
  opts: { signature?: string | null; secret?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const signature =
    opts.signature === undefined ? sign(opts.secret ?? CHANNEL_SECRET, raw) : opts.signature;
  if (signature !== null) headers['x-line-signature'] = signature;
  return fetch(`${BASE_URL}/api/line/webhook/${shopCode}`, { method: 'POST', headers, body: raw });
}

/** 以指定簽章 POST JSON webhook；不等待背景處理。 */
async function postWebhookRaw(
  shopCode: string,
  payload: unknown,
  opts: { signature?: string | null; secret?: string } = {},
): Promise<Response> {
  return postWebhookRawBody(shopCode, JSON.stringify(payload), opts);
}

/** POST webhook 並以測試專用 drain 等待 after() 工作完成。 */
async function postWebhook(
  shopCode: string,
  payload: unknown,
  opts: { signature?: string | null; secret?: string } = {},
): Promise<Response> {
  const res = await postWebhookRaw(shopCode, payload, opts);
  await drainWebhook(shopCode, BASE_URL);
  return res;
}

function textMessageEvent(userId: string, text: string, replyToken: string) {
  return {
    type: 'message',
    replyToken,
    source: { type: 'user', userId },
    message: { id: `m-${replyToken}`, type: 'text', text },
  };
}

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
const mock = new LineMockServer();

/** tenant_settings 快照（afterAll 還原用） */
let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

/** 本檔插入的 keyword_replies id（afterAll 只刪自己的） */
const insertedKeywordIds: string[] = [];

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

async function chatMessagesIn(lineUserId: string) {
  const { data, error } = await admin
    .from('chat_messages')
    .select('id, direction, message_type, content, created_at')
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', lineUserId)
    .eq('direction', 'IN')
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as { id: string; direction: string; message_type: string; content: any }[];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  // Phase 6 前提 env：next dev 必須在啟動時就拿到 LINE_API_BASE（global-setup
  // spread process.env；.env.test 已設）。缺了就在這裡用明確訊息紅燈。
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：Phase 6 整合測試需要主導者在 .env.test（或 global-setup 的 ' +
        'spawn env）加 LINE_API_BASE=http://localhost:4123 與 ' +
        'LINE_DATA_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts ' +
        '打到 tests/helpers/line-mock.ts 起的本地假 LINE server。',
    );
  }
  // SETTINGS_ENCRYPTION_KEY 必須與 server 同一把（.env.test），encryptSecret 才解得回
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await mock.start();

  // ---- SHOP_A：寫入測試 LINE 憑證（先快照，afterAll 還原）----
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

  // ---- keyword_replies：一組 active + 一組 inactive（驗 active 過濾）----
  const { data: krs, error: e2 } = await admin
    .from('keyword_replies')
    .insert([
      {
        tenant_id: SHOP_A.id,
        keywords: [KEYWORD, '折扣'],
        reply_type: 'TEXT',
        content: { text: KEYWORD_REPLY_TEXT },
        active: true,
        sort_order: 0,
      },
      {
        tenant_id: SHOP_A.id,
        keywords: [KEYWORD_INACTIVE],
        reply_type: 'TEXT',
        content: { text: '這則不該被回出去（inactive）' },
        active: false,
        sort_order: 1,
      },
    ])
    .select('id');
  expect(e2).toBeNull();
  for (const r of krs ?? []) insertedKeywordIds.push((r as { id: string }).id);
});

afterAll(async () => {
  // 本檔造出的資料全清（含畸形事件寫入的 line_user_id='' 列）
  const cleanupErrors: Array<[string, unknown]> = [];
  const messagesCleanup = await admin
    .from('chat_messages')
    .delete()
    .eq('tenant_id', SHOP_A.id)
    .in('line_user_id', [USER_WEBHOOK, '']);
  cleanupErrors.push(['chat_messages', messagesCleanup.error]);

  const usersCleanup = await admin
    .from('line_users')
    .delete()
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', USER_WEBHOOK);
  cleanupErrors.push(['line_users', usersCleanup.error]);

  if (insertedKeywordIds.length) {
    const keywordsCleanup = await admin.from('keyword_replies').delete().in('id', insertedKeywordIds);
    cleanupErrors.push(['keyword_replies', keywordsCleanup.error]);
  }
  if (settingsSnapshot) {
    const settingsCleanup = await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
    cleanupErrors.push(['tenant_settings restore', settingsCleanup.error]);
  }

  // Query after DELETE/restore so a green test suite cannot hide residual rows or
  // a cleanup error that was never asserted.
  const { data: remainingMessages, error: messagesResidueError } = await admin
    .from('chat_messages')
    .select('id')
    .eq('tenant_id', SHOP_A.id)
    .in('line_user_id', [USER_WEBHOOK, '']);
  cleanupErrors.push(['chat_messages residue query', messagesResidueError]);

  const { data: remainingUsers, error: usersResidueError } = await admin
    .from('line_users')
    .select('line_user_id')
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', USER_WEBHOOK);
  cleanupErrors.push(['line_users residue query', usersResidueError]);

  let remainingKeywords: unknown[] = [];
  if (insertedKeywordIds.length) {
    const { data, error } = await admin
      .from('keyword_replies')
      .select('id')
      .in('id', insertedKeywordIds);
    cleanupErrors.push(['keyword_replies residue query', error]);
    remainingKeywords = data ?? [];
  }

  let restoredSettings: unknown = null;
  if (settingsSnapshot) {
    const { data, error } = await admin
      .from('tenant_settings')
      .select('line, line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', SHOP_A.id)
      .single();
    cleanupErrors.push(['tenant_settings residue query', error]);
    restoredSettings = data;
  }

  await mock.stop();

  for (const [operation, error] of cleanupErrors) {
    expect(error, `${operation} must not fail`).toBeNull();
  }
  expect(remainingMessages, 'chat_messages residue').toEqual([]);
  expect(remainingUsers, 'line_users residue').toEqual([]);
  expect(remainingKeywords, 'keyword_replies residue').toEqual([]);
  if (settingsSnapshot) {
    expect(restoredSettings).toEqual({
      line: settingsSnapshot.line ?? {},
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    });
  }
});

describe('簽章與店家識別（06 §3）', () => {
  it('沒有 test drain header 的 GET → 405，排空介面不對外開放', async () => {
    const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('壞簽章 → 401；事件完全不進處理且沒有排入背景工作', async () => {
    mock.reset();
    const before = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    const res = await postWebhookRaw(SHOP_A.shopCode, {
      events: [textMessageEvent(USER_WEBHOOK, KEYWORD, 'rt-bad-sig')],
    }, { signature: 'x'.repeat(44) });
    expect(res.status).toBe(401);
    const after = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    expect(after.scheduled).toBe(before.scheduled);
    expect(mock.requests).toHaveLength(0);
    expect(await chatMessagesIn(USER_WEBHOOK)).toHaveLength(0);
  });

  it('好簽章但 JSON malformed → 400、有 parse log 且沒有排入背景工作', async () => {
    mock.reset();
    const before = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    const res = await postWebhookRawBody(SHOP_A.shopCode, '{"events":');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid JSON');

    const after = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    expect(after.scheduled).toBe(before.scheduled);
    expect(after.errors.some((e) => e.includes(`${SHOP_A.shopCode}|parse|`))).toBe(true);
    expect(mock.requests).toHaveLength(0);
  });

  it('缺 x-line-signature header → 401', async () => {
    const res = await postWebhook(SHOP_A.shopCode, { events: [] }, { signature: null });
    expect(res.status).toBe(401);
  });

  it('好簽章（seed 店 + beforeAll 寫入的 secret）空事件 → 200', async () => {
    const res = await postWebhook(SHOP_A.shopCode, { events: [] });
    expect(res.status).toBe(200);
  });

  it('不存在的 shopCode → 404', async () => {
    const res = await postWebhook('no-such-shop', { events: [] });
    expect(res.status).toBe(404);
  });

  it('未設 LINE 憑證的店（SHOP_B）→ 404（無 secret 無從驗簽的實作決策）', async () => {
    const res = await postWebhook(SHOP_B.shopCode, { events: [] }, { signature: null });
    expect(res.status).toBe(404);
  });
});

describe('follow / unfollow → line_users upsert（06 §3、0005）', () => {
  it('follow → line_users upsert followed=true，暱稱/頭像來自 mock profile API', async () => {
    mock.reset();
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [{ type: 'follow', replyToken: 'rt-follow-1', source: { type: 'user', userId: USER_WEBHOOK } }],
    });
    expect(res.status).toBe(200);

    // mock 收到 GET /v2/bot/profile/{userId}，帶解密後的 access token
    const profileReqs = mock.requestsFor(`/v2/bot/profile/${USER_WEBHOOK}`);
    expect(profileReqs).toHaveLength(1);
    expect(profileReqs[0].method).toBe('GET');
    expect(profileReqs[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);

    const { data, error } = await admin
      .from('line_users')
      .select('followed, display_name, picture_url, customer_id')
      .eq('tenant_id', SHOP_A.id)
      .eq('line_user_id', USER_WEBHOOK)
      .single();
    expect(error).toBeNull();
    expect(data!.followed).toBe(true);
    expect(data!.display_name).toBe(`${MOCK_PROFILE_NAME_PREFIX}${USER_WEBHOOK.slice(-4)}`);
    expect(data!.picture_url).toBe(MOCK_PROFILE_PICTURE_URL);

    // seed 的 notify.welcomeMessageText 是空字串 → 不 reply（06 §3「空則略過」）
    expect(mock.requestsFor('/v2/bot/message/reply')).toHaveLength(0);
  });

  it('unfollow → 同一列 followed=false', async () => {
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [{ type: 'unfollow', source: { type: 'user', userId: USER_WEBHOOK } }],
    });
    expect(res.status).toBe(200);

    const { data, error } = await admin
      .from('line_users')
      .select('followed')
      .eq('tenant_id', SHOP_A.id)
      .eq('line_user_id', USER_WEBHOOK)
      .single();
    expect(error).toBeNull();
    expect(data!.followed).toBe(false);
  });

  it('再次 follow → 回到 followed=true（後續訊息案例的前置）', async () => {
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [{ type: 'follow', replyToken: 'rt-follow-2', source: { type: 'user', userId: USER_WEBHOOK } }],
    });
    expect(res.status).toBe(200);
    const { data } = await admin
      .from('line_users')
      .select('followed')
      .eq('tenant_id', SHOP_A.id)
      .eq('line_user_id', USER_WEBHOOK)
      .single();
    expect(data!.followed).toBe(true);
  });
});

describe('text message → chat_messages IN + keyword_replies 命中（06 §3 優先序 ②）', () => {
  it('關鍵字命中 → IN 訊息寫入、mock 收到 reply 且 body 含設定回覆；reply 不佔推播額度', async () => {
    mock.reset();
    const usedBefore = await quotaUsed();

    const res = await postWebhook(SHOP_A.shopCode, {
      events: [textMessageEvent(USER_WEBHOOK, KEYWORD, 'rt-keyword-1')],
    });
    expect(res.status).toBe(200);

    // chat_messages 出現 IN 訊息（無論是否回覆都要寫，06 §3）
    const ins = await chatMessagesIn(USER_WEBHOOK);
    const hit = ins.filter((m) => m.content?.text === KEYWORD);
    expect(hit).toHaveLength(1);
    expect(hit[0].message_type).toBe('text');

    // mock 收到 reply：replyToken 對、訊息文字 = keyword_replies 設定的回覆
    const replies = mock.requestsFor('/v2/bot/message/reply');
    expect(replies).toHaveLength(1);
    expect(replies[0].method).toBe('POST');
    expect(replies[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(replies[0].body.replyToken).toBe('rt-keyword-1');
    expect(replies[0].body.messages).toEqual([{ type: 'text', text: KEYWORD_REPLY_TEXT }]);

    // 06 §2：reply 不佔額度 → push_quota_usage 不變
    expect(await quotaUsed()).toBe(usedBefore);
  });

  it('inactive 關鍵字 → 只寫 IN，不回覆', async () => {
    mock.reset();
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [textMessageEvent(USER_WEBHOOK, KEYWORD_INACTIVE, 'rt-keyword-2')],
    });
    expect(res.status).toBe(200);

    const ins = await chatMessagesIn(USER_WEBHOOK);
    expect(ins.filter((m) => m.content?.text === KEYWORD_INACTIVE)).toHaveLength(1);
    expect(mock.requestsFor('/v2/bot/message/reply')).toHaveLength(0);
  });

  it('未命中任何規則的一般訊息 → 只寫 IN，不回覆（defaultReply 未設定）', async () => {
    mock.reset();
    const text = '這句沒有命中任何關鍵字';
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [textMessageEvent(USER_WEBHOOK, text, 'rt-plain-1')],
    });
    expect(res.status).toBe(200);

    const ins = await chatMessagesIn(USER_WEBHOOK);
    expect(ins.filter((m) => m.content?.text === text)).toHaveLength(1);
    expect(mock.requestsFor('/v2/bot/message/reply')).toHaveLength(0);
  });
});

describe('事件處理丟錯仍回 200（06 §3：LINE 才不會重送）', () => {
  it('LINE API 回 500 令 handler 丟錯 → webhook 仍 200、錯誤有 log，且同批後續事件照常處理', async () => {
    mock.reset();
    mock.failNext(500); // 第一個 reply 請求（rt-err）回 500 → lineReply 丟 ApiHttpError

    const before = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    const res = await postWebhookRaw(SHOP_A.shopCode, {
      events: [
        textMessageEvent(USER_WEBHOOK, KEYWORD, 'rt-err'),
        textMessageEvent(USER_WEBHOOK, KEYWORD, 'rt-after-err'),
      ],
    });
    expect(res.status).toBe(200); // 事件迴圈逐一 try/catch，不冒泡
    const after = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    expect(after.scheduled).toBe(before.scheduled + 1);
    expect(after.errors.some((e) => e.includes(SHOP_A.shopCode) && e.includes('LINE API 錯誤'))).toBe(true);

    // 兩個事件的 IN 訊息都寫入（寫入在 reply 之前）：前面關鍵字案例 1 筆 + 本案例 2 筆
    const ins = await chatMessagesIn(USER_WEBHOOK);
    expect(ins.filter((m) => m.content?.text === KEYWORD)).toHaveLength(3);

    // mock 收到兩次 reply 嘗試：第一次被 failNext 打 500，第二次成功
    const replies = mock.requestsFor('/v2/bot/message/reply');
    expect(replies).toHaveLength(2);
    expect(replies[0].body.replyToken).toBe('rt-err');
    expect(replies[1].body.replyToken).toBe('rt-after-err');
  });

  it('畸形事件（無 source、無 message）→ 仍 200', async () => {
    const res = await postWebhook(SHOP_A.shopCode, {
      events: [{ type: 'message' }, { type: 'follow' }, { type: 'something-unknown' }],
    });
    expect(res.status).toBe(200);
  });
});

describe('先回 200、後處理事件（06 §3.1 / issue #31）', () => {
  it('事件處理卡在 LINE 呼叫時，webhook 先回 200；放行後事件完成', async () => {
    mock.reset();
    const before = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    const messagesBefore = await chatMessagesIn(USER_WEBHOOK);
    const gate = mock.holdNext('/v2/bot/message/reply');
    const posting = postWebhookRaw(SHOP_A.shopCode, {
      events: [textMessageEvent(USER_WEBHOOK, KEYWORD, 'rt-after-1')],
    });

    try {
      await gate.hit;
      const res = await posting;
      expect(res.status).toBe(200);
      expect(mock.requestsFor('/v2/bot/message/reply')).toHaveLength(1);
    } finally {
      gate.release();
    }

    const after = await drainWebhook(SHOP_A.shopCode, BASE_URL);
    expect(after.scheduled).toBe(before.scheduled + 1);
    expect(mock.requestsFor('/v2/bot/message/reply')).toHaveLength(1);
    expect(await chatMessagesIn(USER_WEBHOOK)).toHaveLength(messagesBefore.length + 1);
  });
});
