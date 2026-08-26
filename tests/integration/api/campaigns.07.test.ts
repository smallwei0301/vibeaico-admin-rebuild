/**
 * 行銷活動端點 + 狀態機整合測試 —— issue #7 (乙)「campaigns service 包裝＋接線＋
 * 狀態機整合案例（**PUBLISHED 後 webhook 關鍵字真的回**）」。
 *
 * 契約出處：04 分冊 §B-5（campaigns 端點與狀態機）、06 分冊 §3（webhook 分派：
 * ③ campaigns 關鍵字命中、④ 內建指令「活動」）。
 * 實作 src/app/api/campaigns*、src/server/line-events.ts。
 * 前端鏈路：src/app/tenant/campaigns/page.tsx → src/services/campaigns.ts → 本檔端點。
 *
 * ⚠️ 這一檔的重點不是「端點回 200」。
 * `publish` 只是把 `campaigns.status` 從 DRAFT 改成 PUBLISHED——那個欄位值本身
 * 對店家沒有意義，它的意義完全來自 `src/server/line-events.ts`：只有 PUBLISHED 的
 * 活動會被回給顧客。所以本檔每一個狀態轉換都**用顧客那一端驗**：發一個真的
 * webhook 事件（顧客打「活動」），看 mock LINE 收到的 reply 文字裡有沒有這一筆。
 * 只驗 DB 欄位的話，把 line-events.ts 的 `.eq('status','PUBLISHED')` 刪掉也照樣全綠。
 *
 * ⚠️ 等待紀律（issue #31 之後）：webhook route 驗簽後**立刻回 200**，事件處理在
 * `after()` 裡跑（06 §3.1）。拿到 200 的當下 reply 還沒送到 mock LINE，所以一律用
 * `tests/helpers/line-webhook.ts` 的 `drainWebhook()` 等——那是 server 端保證的
 * 完成訊號，不是 sleep 猜等（12 §2.3 禁用 sleep 等待）。
 *
 * ⚠️ 反向斷言（「暫停後顧客查不到這一筆」）**不用「沒有 reply」**來證明：
 * 那種寫法只要背景工作還沒跑到就會假綠燈。這裡的作法是讓同一次回覆裡帶著
 * **另一筆仍在進行中的活動**——reply 確實送出了、內容也讀得到，就是不含被暫停的
 * 那一筆。負向結論被一個已抵達的正向訊號界定住（14 分冊 §6.16-a 的同一個原則）。
 *
 * 基線紀律：本檔造出的 campaigns / line_users / chat_messages 在 afterAll 全刪，
 * tenant_settings 還原快照。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const REPLY_PATH = '/v2/bot/message/reply';

const CHANNEL_SECRET = 'itest-cm07-channel-secret-a';
const CHANNEL_TOKEN = 'itest-cm07-access-token-a';

/** 本檔專用 LINE user id（避免與其他檔互踩） */
const USER = 'Ucm07itest0000000000000000000001';

/**
 * 「活動」是系統內建關鍵字 15 組的 CAMPAIGN 組
 * （src/i18n/zh-TW/pages/keyword-replies.ts system.groups → line-events.ts
 * SYSTEM_KEYWORD_GROUPS），走 ④ 內建指令的 replyCampaigns()，會列出全部 PUBLISHED。
 */
const BUILTIN_CAMPAIGN_WORD = '活動';

/**
 * 這一筆整檔都保持 PUBLISHED，當作反向斷言的**正向訊號**：
 * 任何一次「顧客打活動」的回覆裡都必須看得到它，否則就不是「被暫停的那筆不見了」，
 * 而是「webhook 根本還沒跑到」——兩者要分得開。
 */
const ANCHOR_NAME = '#7乙 常駐活動（錨點）';
const ANCHOR_TEXT = '這一筆整檔都在進行中';

type SettingsSnapshot = {
  line: unknown;
  line_channel_secret_enc: string | null;
  line_channel_access_token_enc: string | null;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();
let settingsSnapshot: SettingsSnapshot | null = null;
const createdIds: string[] = [];
let anchorId: string;
let replySeq = 0;

/** LINE 官方簽章規則（與 route.ts 驗簽演算法互為鏡像） */
function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

/**
 * 送一個文字訊息事件給 webhook，並**等到 after() 的事件處理跑完**才回來。
 * 用 drainWebhook（server 端 await 掉所有未完成的背景處理），不是 sleep。
 */
async function customerSays(text: string): Promise<void> {
  replySeq += 1;
  const raw = JSON.stringify({
    destination: 'Ucm07dest',
    events: [{
      type: 'message',
      replyToken: `cm07reply${replySeq}`,
      source: { type: 'user', userId: USER },
      message: { id: `cm07msg${replySeq}`, type: 'text', text },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
}

/** 取這次 webhook 之後 mock LINE 收到的最後一則 reply 的純文字內容 */
function lastReplyText(): string {
  const calls = mock.requestsFor(REPLY_PATH);
  expect(calls.length, '沒有任何 reply 送到 mock LINE').toBeGreaterThan(0);
  const messages = calls[calls.length - 1].body?.messages as { type: string; text?: string }[];
  return messages.map((m) => m.text ?? '').join('\n');
}

/** service role 直查活動列（期望值一律直查現有資料，不信端點自己的回應） */
async function campaignRow(id: string) {
  const { data, error } = await admin.from('campaigns')
    .select('id, name, keyword, status, content, start_at, end_at')
    .eq('id', id).maybeSingle();
  expect(error).toBeNull();
  return data as {
    id: string; name: string; keyword: string; status: string;
    content: Record<string, unknown>; start_at: string | null; end_at: string | null;
  } | null;
}

/** 走端點建一筆活動（順便當作「建立」的鏈路證據），回 id */
async function createCampaign(body: Record<string, unknown>): Promise<string> {
  const res = await ownerA.post('/api/campaigns', body);
  expect(res.status).toBe(200);
  const { data } = await res.json();
  createdIds.push(data.id);
  return data.id as string;
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

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as SettingsSnapshot;
  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 錨點活動：走端點建立 + 發布，整檔保持 PUBLISHED
  anchorId = await createCampaign({
    name: ANCHOR_NAME, content: { text: ANCHOR_TEXT },
  });
  expect((await ownerA.post(`/api/campaigns/${anchorId}/publish`)).status).toBe(200);
  expect((await campaignRow(anchorId))?.status).toBe('PUBLISHED');
});

afterAll(async () => {
  for (const id of createdIds) await admin.from('campaigns').delete().eq('id', id);
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line,
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

/* ========================================================================== */

describe('campaigns CRUD（頁面的「新增活動」「編輯」「刪除」鏈路）', () => {
  it('建立 → DB 的 status 是 DRAFT，展示欄位存進 content jsonb', async () => {
    const id = await createCampaign({
      name: '#7乙 新建活動', description: '描述文字', type: 'LIMITED_TIME',
      content: { text: '推播文案', bonusPoints: 300, isAutoTrigger: true },
    });

    const row = await campaignRow(id);
    // 新建一律 DRAFT —— 「存檔」不等於「發布」，這是頁面 draftNotice 承諾的事
    expect(row?.status).toBe('DRAFT');
    expect(row?.name).toBe('#7乙 新建活動');
    expect(row?.content.description).toBe('描述文字');
    expect(row?.content.type).toBe('LIMITED_TIME');
    expect(row?.content.text).toBe('推播文案');
    expect(row?.content.bonusPoints).toBe(300);
    expect(row?.content.isAutoTrigger).toBe(true);

    const res = await ownerA.get('/api/campaigns');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const found = data.find((c: { id: string }) => c.id === id);
    expect(found?.status).toBe('DRAFT');
    expect(found?.description).toBe('描述文字');
  });

  it('編輯 → 名稱與推播文案真的改到 DB（不是只回 200）', async () => {
    const id = await createCampaign({ name: '#7乙 待編輯', content: { text: '舊文案' } });

    const res = await ownerA.put(`/api/campaigns/${id}`, {
      name: '#7乙 已編輯', content: { text: '新文案' },
    });
    expect(res.status).toBe(200);

    const row = await campaignRow(id);
    expect(row?.name).toBe('#7乙 已編輯');
    expect(row?.content.text).toBe('新文案');
  });

  it('刪除 → DB 真的沒有這一列（DELETE /api/campaigns/:id 是本 issue 補上的）', async () => {
    const id = await createCampaign({ name: '#7乙 待刪除', content: { text: 'x' } });
    expect(await campaignRow(id)).not.toBeNull();

    const res = await ownerA.delete(`/api/campaigns/${id}`);
    expect(res.status).toBe(200);
    expect(await campaignRow(id)).toBeNull();
  });

  it('刪除不存在的 id → 404（不能靜靜回成功，否則頁面會顯示「活動已刪除」卻什麼都沒刪）', async () => {
    const res = await ownerA.delete('/api/campaigns/00000000-0000-4000-8000-0000000007cc');
    expect(res.status).toBe(404);
  });

  it('別家店的活動 id → 刪除回 404，而且那一列還在（跨租戶隔離）', async () => {
    const id = await createCampaign({ name: '#7乙 A 店的活動', content: { text: 'x' } });
    const res = await ownerB.delete(`/api/campaigns/${id}`);
    expect(res.status).toBe(404);
    expect(await campaignRow(id)).not.toBeNull();
  });
});

describe('campaigns 狀態機：每一步都用「顧客那一端收到什麼」驗證', () => {
  it('DRAFT（還沒發布）→ 顧客打「活動」時收得到錨點活動，但收不到這一筆', async () => {
    const id = await createCampaign({
      name: '#7乙 尚未發布的活動', content: { text: '草稿階段不該外流' },
    });
    expect((await campaignRow(id))?.status).toBe('DRAFT');

    await customerSays(BUILTIN_CAMPAIGN_WORD);
    const text = lastReplyText();
    // 正向訊號：webhook 真的回了（不是「還沒跑到」）
    expect(text).toContain(ANCHOR_NAME);
    // 負向結論被上面那一行界定住
    expect(text).not.toContain('#7乙 尚未發布的活動');
    expect(text).not.toContain('草稿階段不該外流');
  });

  it('publish → DB 轉 PUBLISHED，且顧客打「活動」時真的收到這一筆的名稱與文案', async () => {
    const id = await createCampaign({
      name: '#7乙 發布後看得到', content: { text: '限時九折，出示本訊息即可' },
    });

    const res = await ownerA.post(`/api/campaigns/${id}/publish`);
    expect(res.status).toBe(200);
    expect((await campaignRow(id))?.status).toBe('PUBLISHED');

    await customerSays(BUILTIN_CAMPAIGN_WORD);
    const text = lastReplyText();
    expect(text).toContain('#7乙 發布後看得到');
    expect(text).toContain('限時九折，出示本訊息即可');
  });

  it('PUBLISHED + keyword → 顧客打那個關鍵字，收到的是這筆活動的文案（webhook ③ 分支）', async () => {
    const keyword = '#7乙專屬關鍵字';
    const id = await createCampaign({
      name: '#7乙 關鍵字活動', keyword, content: { text: '關鍵字命中才會看到的文案' },
    });
    /**
     * 還沒發布 → 打關鍵字不該命中這一筆（③ 分支限定 status='PUBLISHED'）。
     *
     * ⚠️ 這裡**不能**用 lastReplyText()：實測發現這家店沒有設 defaultReply、
     * AI 也判不出來，於是「一個沒人認得的字」在 ⑥ 之後就結束了，webhook 一則
     * reply 都不會送出（line-events.ts ⑥ 的 `lineConfig.defaultReply` 為空）。
     * 那是正確行為，不是 bug——但它讓「取最後一則 reply」這種寫法直接炸掉。
     *
     * 所以改成：先確認整批 reply 裡沒有那段文案（drainWebhook 已經保證這次事件
     * 處理跑完了，這個負向斷言不是在等時間），再送一次「活動」讓錨點回來，
     * 證明 webhook 這條路確實還活著——負向結論仍然被一個正向訊號界定住。
     */
    await customerSays(keyword);
    expect(mock.requestsFor(REPLY_PATH).map((r) => JSON.stringify(r.body)).join('\n'))
      .not.toContain('關鍵字命中才會看到的文案');
    await customerSays(BUILTIN_CAMPAIGN_WORD);
    expect(lastReplyText()).toContain(ANCHOR_NAME);

    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);

    mock.reset();
    await customerSays(keyword);
    // ③ 分支回的是單獨一則活動文案，不是「活動」清單
    expect(lastReplyText()).toBe('關鍵字命中才會看到的文案');
  });

  it('pause → DB 轉 PAUSED，且顧客打「活動」時這一筆消失（錨點仍在＝webhook 確實回了）', async () => {
    const id = await createCampaign({
      name: '#7乙 暫停測試活動', content: { text: '暫停後不該再出現' },
    });
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);

    // 先證明「發布後看得到」，暫停後的消失才有意義
    await customerSays(BUILTIN_CAMPAIGN_WORD);
    expect(lastReplyText()).toContain('#7乙 暫停測試活動');

    const res = await ownerA.post(`/api/campaigns/${id}/pause`);
    expect(res.status).toBe(200);
    expect((await campaignRow(id))?.status).toBe('PAUSED');

    mock.reset();
    await customerSays(BUILTIN_CAMPAIGN_WORD);
    const text = lastReplyText();
    expect(text).toContain(ANCHOR_NAME);            // 正向訊號
    expect(text).not.toContain('#7乙 暫停測試活動');  // 被界定住的負向結論
    expect(text).not.toContain('暫停後不該再出現');
  });

  it('resume → DB 轉回 PUBLISHED，顧客打「活動」時又看得到', async () => {
    const id = await createCampaign({
      name: '#7乙 恢復測試活動', content: { text: '恢復後又看得到' },
    });
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);
    expect((await ownerA.post(`/api/campaigns/${id}/pause`)).status).toBe(200);

    await customerSays(BUILTIN_CAMPAIGN_WORD);
    expect(lastReplyText()).not.toContain('#7乙 恢復測試活動');

    const res = await ownerA.post(`/api/campaigns/${id}/resume`);
    expect(res.status).toBe(200);
    expect((await campaignRow(id))?.status).toBe('PUBLISHED');

    mock.reset();
    await customerSays(BUILTIN_CAMPAIGN_WORD);
    expect(lastReplyText()).toContain('#7乙 恢復測試活動');
  });

  it('end → DB 轉 ENDED（終態），顧客打「活動」時這一筆消失且不能再恢復', async () => {
    const id = await createCampaign({
      name: '#7乙 結束測試活動', content: { text: '結束後不該再出現' },
    });
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);

    const res = await ownerA.post(`/api/campaigns/${id}/end`);
    expect(res.status).toBe(200);
    expect((await campaignRow(id))?.status).toBe('ENDED');

    // 終態不可再轉出
    expect((await ownerA.post(`/api/campaigns/${id}/resume`)).status).toBe(409);
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(409);
    expect((await campaignRow(id))?.status).toBe('ENDED');

    await customerSays(BUILTIN_CAMPAIGN_WORD);
    const text = lastReplyText();
    expect(text).toContain(ANCHOR_NAME);
    expect(text).not.toContain('#7乙 結束測試活動');
  });

  it('非法轉換一律 409 且狀態不變：DRAFT 不能 pause/resume/end、PUBLISHED 不能重複 publish', async () => {
    const id = await createCampaign({ name: '#7乙 非法轉換', content: { text: 'x' } });

    for (const action of ['pause', 'resume', 'end']) {
      const res = await ownerA.post(`/api/campaigns/${id}/${action}`);
      expect(res.status, `DRAFT 不該能 ${action}`).toBe(409);
    }
    expect((await campaignRow(id))?.status).toBe('DRAFT');

    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(409);
    expect((await campaignRow(id))?.status).toBe('PUBLISHED');
  });

  it('ENDED 後不可編輯 → PUT 回 409，DB 的名稱沒有被改動', async () => {
    const id = await createCampaign({ name: '#7乙 結束後鎖定', content: { text: 'x' } });
    expect((await ownerA.post(`/api/campaigns/${id}/publish`)).status).toBe(200);
    expect((await ownerA.post(`/api/campaigns/${id}/end`)).status).toBe(200);

    const res = await ownerA.put(`/api/campaigns/${id}`, { name: '#7乙 不該改得動' });
    expect(res.status).toBe(409);
    expect((await campaignRow(id))?.name).toBe('#7乙 結束後鎖定');
  });
});
