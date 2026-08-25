/**
 * 關鍵字回覆端到端整合測試（GitHub issue #5「修復-3」）
 * -----------------------------------------------------------------------------
 * 這一檔要證的**不是** CRUD 端點會不會動（gating.09 早就打過），而是那條真正
 * 對顧客有意義的鏈路：
 *
 *   keyword-replies 頁 → src/services/keyword-replies.ts → /api/settings/line/keyword-replies
 *   → keyword_replies 表 → LINE webhook 分支 ② → mock LINE 收到店家設定的那段文字
 *
 * 14 分冊 §1 根因 A：頁面原本整頁 CRUD 都只有 setState + 「已儲存」toast，
 * 店家設好關鍵字、看到成功訊息，顧客在 LINE 打那個字**永遠不會有任何回應**。
 * 只測端點不會抓到這個缺陷（端點一直是好的），所以每個寫入案例都刻意用
 * **service 層的 toApiPayload() 組 body**（頁面送出的就是這個形狀），
 * 再從 webhook 那一端把訊息接回來。
 *
 * 另一半（issue #5 ③）：`/api/settings/line/rich-menu/create` 發布的六格是
 * message action ——顧客按下去等於送出 MODE_PRESETS[businessType].richMenuCells
 * 的那段文字。三業態 × 六格 ＝ 18 段，這裡**程式化列舉**逐一打 webhook，
 * 斷言每一段都拿到「非 defaultReply」的回覆。未來有人改 cells 卻沒補 handler，
 * 這裡會自動紅（手寫清單則會跟著漏，測試永遠綠、顧客永遠按了沒反應）。
 *
 * 前置資料與清理紀律比照 tests/integration/api/line-webhook.06.test.ts：
 * beforeAll 快照 SHOP_A 的 tenant_settings（line jsonb + 兩個 *_enc）與
 * tenants.business_type，寫入本檔專用的測試憑證；afterAll 一律還原，並刪掉
 * 本檔造出的 keyword_replies / chat_messages / line_users。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { LineMockServer, type RecordedLineRequest } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';
import { BUSINESS_TYPES, MODE_PRESETS, type BusinessType } from '@/config/modes';
import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';
import { toApiPayload, type KeywordReplyRow } from '@/services/keyword-replies';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-a05';
const CHANNEL_TOKEN = 'itest-line-access-token-a05';

/** 本檔專用 LINE user id（避免跟 line-webhook.06 / chat-link.06 互踩） */
const USER = 'Ukeyword05itest0000000000000000001';

/**
 * 「都沒命中」時的分支 ⑥ 回覆。
 * 有了它，「命中了」與「沒命中」在斷言上才分得開——
 * rich menu 每一格都必須拿到「不等於這句」的回覆。
 */
const DEFAULT_REPLY = '【itest】這是分支⑥的預設回覆，代表沒有任何 handler 命中';

let admin: SupabaseClient;
let api: AuthedApi;
const mock = new LineMockServer();

/** 本檔插入的 keyword_replies id（afterAll 只刪自己的） */
const createdIds: string[] = [];

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let businessTypeSnapshot = 'LOCAL_SHOP';

/** LINE 官方簽章規則（與 route.ts 驗簽演算法互為鏡像） */
function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

/** 以顧客身分送一則文字訊息給 webhook，回傳 mock LINE 收到的 reply 文字（沒回覆＝null） */
async function customerSays(text: string, replyToken = `rt-${Math.random().toString(36).slice(2)}`) {
  mock.reset();
  const payload = {
    destination: 'Umockbot',
    events: [{
      type: 'message',
      replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  };
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status, `webhook 對「${text}」回了 ${res.status}`).toBe(200);
  // issue #31：回 200 後事件才在 after() 裡處理（06 §3.1），要等背景跑完再看 mock。
  // drainWebhook 是 server 端的確定性完成訊號，不是 sleep 猜等（12 §2.3）。
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  const replies = mock.requestsFor('/v2/bot/message/reply');
  if (replies.length === 0) return null;
  expect(replies).toHaveLength(1);
  return String(replies[0].body?.messages?.[0]?.text ?? '');
}

/**
 * 打一則顧客訊息，回傳 mock LINE 在**這一輪**收到的全部請求。
 *
 * 「bot 閉嘴了」的最強斷言是這個陣列為空，而不是 `customerSays() === null`：
 * customerSays 只翻 `/v2/bot/message/reply`，push / multicast 偷跑它抓不到。
 * message 事件不會呼叫 `GET /v2/bot/profile`（那只在 follow 事件，見
 * src/server/line-events.ts 的 onFollow），所以真的沒回應時這裡必須是 0 筆。
 */
async function lineCallsFor(text: string): Promise<RecordedLineRequest[]> {
  mock.reset();
  const replyToken = `rt-${Math.random().toString(36).slice(2)}`;
  const raw = JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message',
      replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status, `webhook 對「${text}」回了 ${res.status}`).toBe(200);
  // issue #31：同上——「bot 閉嘴了」這種反向斷言尤其不能靠時間猜，
  // 否則背景工作只是還沒跑到，測試照樣綠。
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
  return [...mock.requests];
}

/** 切換 SHOP_A 的 KEYWORD_REPLY 訂閱狀態（種子基線是 GRANTED，afterAll 會還原） */
async function setKeywordReplyFeature(active: boolean): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .update({ active })
    .eq('tenant_id', SHOP_A.id)
    .eq('code', 'KEYWORD_REPLY');
  expect(error).toBeNull();
}

/** 頁面表單的一列 → 端點 body（**刻意走 service 層的 toApiPayload**，形狀與頁面完全相同） */
function pagePayload(row: Partial<Omit<KeywordReplyRow, 'id'>>) {
  return toApiPayload({
    keyword: '', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT', replyText: '',
    imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
    ...row,
  });
}

/** 以登入後的 session 建一組關鍵字（＝頁面 save() 走的那條路），回傳 id */
async function createViaApi(row: Partial<Omit<KeywordReplyRow, 'id'>>): Promise<string> {
  const res = await api.post('/api/settings/line/keyword-replies', pagePayload(row));
  const body = await res.json();
  expect(res.status, `建立關鍵字失敗：${JSON.stringify(body)}`).toBe(200);
  const id = body.data.id as string;
  createdIds.push(id);
  return id;
}

async function deleteAllKeywords(): Promise<void> {
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
  createdIds.length = 0;
}

/** 直接改 line jsonb（測試前置用；店家介面走的是 PUT /api/settings/line，另有案例驗） */
async function patchLineJsonb(patch: Record<string, unknown>): Promise<void> {
  const { data } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
  const { error } = await admin
    .from('tenant_settings')
    .update({ line: { ...((data?.line ?? {}) as object), ...patch } })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

async function setBusinessType(bt: BusinessType): Promise<void> {
  const { error } = await admin.from('tenants').update({ business_type: bt }).eq('id', SHOP_A.id);
  expect(error).toBeNull();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test 設 LINE_API_BASE=http://localhost:4123 ' +
        '與 LINE_DATA_API_BASE=http://localhost:4123（見 line-webhook.06.test.ts 的同段說明）。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();

  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;

  const { data: tsnap } = await admin
    .from('tenants').select('business_type').eq('id', SHOP_A.id).single();
  businessTypeSnapshot = (tsnap?.business_type as string) ?? 'LOCAL_SHOP';

  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
      line: {
        autoReplyEnabled: true,
        defaultReply: DEFAULT_REPLY,
        systemKeywordGroupsDisabled: [],
        campaignKeywordEnabled: false, // ③ campaigns 不參與本檔斷言
      },
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  await deleteAllKeywords();
  api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  await deleteAllKeywords();
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('tenants').update({ business_type: businessTypeSnapshot }).eq('id', SHOP_A.id);
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

/* ========================================================================== */
/* ① 頁面存了關鍵字 → webhook 就認得（本 issue 最關鍵的一條）                    */
/* ========================================================================== */
describe('頁面 → 端點 → webhook 全鏈（issue #5 ①②；14 分冊 §1 根因 A）', () => {
  beforeEach(async () => {
    await deleteAllKeywords();
    await setBusinessType('LOCAL_SHOP');
  });

  it('透過 API 建立關鍵字（非 service role 直插）→ 顧客打那個字 → mock LINE 收到店家設定的回覆', async () => {
    const REPLY = '店門口有 3 個機車位，汽車請停巷口收費停車場。';
    await createViaApi({ keyword: '整測停車', matchType: 'EXACT', replyText: REPLY });

    // 端點真的寫進表了（不是只回 200）
    const { data: rows } = await admin
      .from('keyword_replies').select('keywords, content, active').eq('tenant_id', SHOP_A.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].keywords).toEqual(['整測停車']);
    expect((rows![0].content as any).text).toBe(REPLY);

    expect(await customerSays('整測停車')).toBe(REPLY);
  });

  it('CONTAINS：顧客打整句話也命中（頁面預設就是「訊息裡有這個字就回」）', async () => {
    const REPLY = '剪髮 NT$600 起，染燙另計。';
    await createViaApi({ keyword: '整測價格', matchType: 'CONTAINS', replyText: REPLY });

    expect(await customerSays('請問整測價格大概多少')).toBe(REPLY);
    // 對照組：不含該字 → 落到分支 ⑥
    expect(await customerSays('請問你們幾點打烊呢')).toBe(DEFAULT_REPLY);
  });

  it('EXACT：只有一字不差才回（頁面選「訊息就是這個字才回」的語意）', async () => {
    await createViaApi({ keyword: '整測地址', matchType: 'EXACT', replyText: '台北市中山區 1 號' });

    expect(await customerSays('整測地址')).toBe('台北市中山區 1 號');
    expect(await customerSays('請問整測地址在哪')).toBe(DEFAULT_REPLY);
  });

  it('附加連結按鈕真的送到顧客眼前（頁面存得進去的欄位就必須送出去）', async () => {
    await createViaApi({
      keyword: '整測價目', matchType: 'EXACT', replyText: '價目表如下',
      linkUrl: 'https://example.com/price', linkLabel: '查看完整價目表',
    });
    const got = await customerSays('整測價目');
    expect(got).toContain('價目表如下');
    expect(got).toContain('查看完整價目表');
    expect(got).toContain('https://example.com/price');
  });

  it('停用（PUT active=false）→ 不再回那段設定，落到分支 ⑥', async () => {
    const id = await createViaApi({ keyword: '整測活動', matchType: 'EXACT', replyText: '限時九折' });
    expect(await customerSays('整測活動')).toBe('限時九折');

    const res = await api.put(`/api/settings/line/keyword-replies/${id}`, { active: false });
    expect(res.status).toBe(200);
    expect(await customerSays('整測活動')).toBe(DEFAULT_REPLY);

    // 重新啟用 → 又回來（頁面上的那顆 Switch 走的就是這條路）
    expect((await api.put(`/api/settings/line/keyword-replies/${id}`, { active: true })).status).toBe(200);
    expect(await customerSays('整測活動')).toBe('限時九折');
  });

  it('編輯（PUT 全欄）→ 顧客拿到的是改後的新內容', async () => {
    const id = await createViaApi({ keyword: '整測寄物', matchType: 'EXACT', replyText: '舊回覆' });
    expect(await customerSays('整測寄物')).toBe('舊回覆');

    const res = await api.put(
      `/api/settings/line/keyword-replies/${id}`,
      pagePayload({ keyword: '整測寄物', matchType: 'EXACT', replyText: '新回覆：櫃檯可代為保管' }),
    );
    expect(res.status).toBe(200);
    expect(await customerSays('整測寄物')).toBe('新回覆：櫃檯可代為保管');
  });

  it('刪除（DELETE）→ 顧客打那個字不再有那段回覆', async () => {
    const id = await createViaApi({ keyword: '整測外送', matchType: 'EXACT', replyText: '可外送' });
    expect(await customerSays('整測外送')).toBe('可外送');

    expect((await api.delete(`/api/settings/line/keyword-replies/${id}`)).status).toBe(200);
    expect(await customerSays('整測外送')).toBe(DEFAULT_REPLY);
    createdIds.length = 0;
  });

  it('GET 清單回得出剛剛存的內容（頁面重新整理後看得到自己設的字）', async () => {
    await createViaApi({ keyword: '整測寵物', matchType: 'CONTAINS', replyText: '歡迎攜帶寵物' });
    const res = await api.get('/api/settings/line/keyword-replies');
    const body = await res.json();
    expect(res.status).toBe(200);
    const row = body.data.find((r: any) => r.keywords[0] === '整測寵物');
    expect(row).toBeTruthy();
    expect(row.content.text).toBe('歡迎攜帶寵物');
    expect(row.content.matchType).toBe('CONTAINS');
  });

  it('自訂關鍵字優先於內建指令（06 §3 優先序：② 早於 ④）', async () => {
    // 「預約」本來是內建指令（回服務清單）；店家把它改成自己的內容後應以店家的為準
    await createViaApi({
      keyword: '預約', matchType: 'EXACT', replyText: '請直接來電 02-1234-5678 預約',
      overridesSystem: '預約',
    });
    expect(await customerSays('預約')).toBe('請直接來電 02-1234-5678 預約');
  });
});

/* ========================================================================== */
/* ② Rich Menu 三業態 18 格逐一打 webhook（issue #5 ③）                        */
/* ========================================================================== */
describe('Rich Menu 六格文字全部有回應（issue #5 ③；06 §3 補列規格）', () => {
  beforeAll(async () => {
    // 分支 ② 早於 ④：留著自訂關鍵字會遮住內建指令，這一段必須清空
    await deleteAllKeywords();
  });

  for (const bt of BUSINESS_TYPES) {
    describe(`業態 ${bt}`, () => {
      beforeAll(async () => { await setBusinessType(bt); });

      // 程式化列舉：改了 modes.ts 卻沒補 handler，這裡自動紅
      for (const [i, cell] of MODE_PRESETS[bt].richMenuCells.entries()) {
        it(`第 ${i + 1} 格「${cell.label}」送出「${cell.text}」→ 有非 defaultReply 的回覆`, async () => {
          const got = await customerSays(cell.text);
          expect(got, `顧客按「${cell.label}」→ 送出「${cell.text}」→ webhook 完全沒回應`)
            .not.toBeNull();
          expect(got, `「${cell.text}」落到了分支 ⑥ defaultReply ＝ 沒有 handler 認得`)
            .not.toBe(DEFAULT_REPLY);
          expect(String(got).length).toBeGreaterThan(0);
        });
      }
    });
  }

  it('尚未建置的功能誠實說「還在準備中」，不沉默也不編造進度（CLAUDE.md 誠實原則）', async () => {
    await setBusinessType('GUIDE');
    expect(await customerSays('團次')).toContain('準備中');
    expect(await customerSays('我的訂單')).toContain('準備中');
    await setBusinessType('CLINIC');
    expect(await customerSays('看診進度')).toContain('準備中');
  });
});

/* ========================================================================== */
/* ③ 系統內建關鍵字 15 組同義詞 ＋ 停用開關（issue #5 ④）                       */
/* ========================================================================== */
describe('系統內建關鍵字 15 組（issue #5 ④；06 §3 補列規格）', () => {
  const groups = keywordRepliesPage.system.groups;

  beforeAll(async () => {
    await deleteAllKeywords();
    // GUIDE 是唯一能讓 15 組全部有回應的業態：行程/出團日期兩組屬 TOUR_MODULE，
    // 一般店家收到「行程」時 replyBuiltin 刻意回 false（落到 ⑤/⑥ 比硬回
    // 「目前沒有行程」自然），那是設計，不是漏接——另有對照案例驗這件事。
    await setBusinessType('GUIDE');
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
  });

  for (const g of groups) {
    it(`${g.label}（${g.key}）組的 ${g.keywords.length} 個同義詞全部命中`, async () => {
      for (const k of g.keywords) {
        const got = await customerSays(k);
        expect(got, `系統關鍵字「${k}」webhook 沒回應`).not.toBeNull();
        expect(got, `系統關鍵字「${k}」落到 defaultReply ＝ 沒有 handler 認得`)
          .not.toBe(DEFAULT_REPLY);
      }
    }, 30_000);
  }

  /**
   * `replyBuiltin` 回 false（＝刻意不攔截、落到 ⑤/⑥）的條件，實跑校正後的正解：
   * **不是**「業態不是 GUIDE」，而是「這家店一筆已上架行程都沒有 **且** 業態不是
   * GUIDE」——`replyTrips` 先查 trips，查得到就照回，不看業態（斜槓店家把行程賣給
   * 一般顧客是合理的）。第一版測試把條件寫成前者而紅，修正的是測試不是實作。
   */
  it('「行程」：有上架行程就照回；一筆都沒有時一般店家才落到 ⑥、嚮導則誠實說敬請期待', async () => {
    await setBusinessType('LOCAL_SHOP');
    // (1) 種子的 A 店有一筆 PUBLISHED 行程 → 業態是一般店家也照樣回清單
    expect(await customerSays('行程')).toContain('A 店測試行程');

    // (2) 全部下架 → 這時才走到 handled=false 那條路
    const { data: before } = await admin
      .from('trips').select('id, status').eq('tenant_id', SHOP_A.id);
    const { error } = await admin
      .from('trips').update({ status: 'DRAFT' }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    try {
      expect(await customerSays('行程')).toBe(DEFAULT_REPLY);
      // 嚮導的選單第一格就是這個字，一定要有回應——沉默不可接受
      await setBusinessType('GUIDE');
      expect(await customerSays('行程')).toContain('敬請期待');
    } finally {
      for (const row of before ?? []) {
        await admin.from('trips').update({ status: (row as any).status }).eq('id', (row as any).id);
      }
      await setBusinessType('GUIDE');
    }
  }, 30_000);
});

describe('系統關鍵字停用開關真的存得進去、也真的生效（issue #5 ④）', () => {
  beforeAll(async () => {
    await deleteAllKeywords();
    await setBusinessType('LOCAL_SHOP');
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
  });

  it('PUT /api/settings/line（頁面 saveLineSettings 走的那支）把停用清單寫進 line jsonb', async () => {
    const res = await api.put('/api/settings/line', { systemKeywordGroupsDisabled: ['COUPON'] });
    expect(res.status).toBe(200);

    const { data } = await admin
      .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
    expect((data!.line as any).systemKeywordGroupsDisabled).toEqual(['COUPON']);
    // 同一支端點的其他欄位不能被這次局部更新洗掉
    expect((data!.line as any).defaultReply).toBe(DEFAULT_REPLY);
  });

  it('停用的組＝顧客打這些字「完全沒有回應」（不落到 ⑥，與頁面確認視窗的原話一致）', async () => {
    await patchLineJsonb({ systemKeywordGroupsDisabled: ['COUPON'] });
    // 該組的每一個同義詞都不回
    for (const k of ['優惠券', '我的票券', '領取票券']) {
      expect(await customerSays(k), `「${k}」在停用後仍有回應`).toBeNull();
    }
    // 「其他字不受影響」——沒被停用的組照常回應
    const menu = await customerSays('選單');
    expect(menu).not.toBeNull();
    expect(menu).not.toBe(DEFAULT_REPLY);
  });

  it('恢復（清空清單）→ 該組又回應了', async () => {
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
    const got = await customerSays('優惠券');
    expect(got).not.toBeNull();
    expect(got).not.toBe(DEFAULT_REPLY);
  });

  it('停用中的組被店家用自訂關鍵字覆蓋 → 回自訂內容（② 早於 ④，停用不擋 ②）', async () => {
    await patchLineJsonb({ systemKeywordGroupsDisabled: ['COUPON'] });
    await createViaApi({ keyword: '優惠券', matchType: 'EXACT', replyText: '本月優惠券已發完囉', overridesSystem: '優惠券' });
    expect(await customerSays('優惠券')).toBe('本月優惠券已發完囉');
    await deleteAllKeywords();
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
  });
});

/* ========================================================================== */
/* ④ 20 組上限閘門在頁面路徑仍生效（issue #5 第 ⑥ 勾）                          */
/* ========================================================================== */
describe('20 組上限閘門（09 分冊 §5）在頁面走的端點上仍生效', () => {
  beforeAll(async () => { await deleteAllKeywords(); });
  afterAll(async () => { await deleteAllKeywords(); });

  it('第 21 組 → 409「每店最多 20 組」（頁面把這個 message 原樣顯示給店家）', async () => {
    for (let i = 0; i < 20; i += 1) {
      await createViaApi({ keyword: `整測上限${i}`, matchType: 'EXACT', replyText: `回覆${i}` });
    }
    const res = await api.post('/api/settings/line/keyword-replies', pagePayload({
      keyword: '整測上限21', matchType: 'EXACT', replyText: '第 21 組',
    }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.message).toBe('每店最多 20 組');

    const { count } = await admin
      .from('keyword_replies').select('id', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id);
    expect(count).toBe(20);
  }, 60_000);
});

/* ========================================================================== */
/* ⑤ 付費閘門的邊界（14 分冊 §8.16 擁有者裁決）                                 */
/*                                                                            */
/*    停用設定一律生效，付費閘門只擋「自訂內容」。                                */
/*    ——「關掉某個東西」不該需要付費：一間停止訂閱的店家沒辦法讓 bot 閉嘴，       */
/*      在診所這種要求對外訊息全部由專人處理的業態可能是合規問題。                */
/* ========================================================================== */
describe('未訂閱 KEYWORD_REPLY 時的閘門邊界（14 分冊 §8.16）', () => {
  beforeAll(async () => {
    await deleteAllKeywords();
    await setBusinessType('LOCAL_SHOP');
  });
  afterAll(async () => {
    // 還原贈與狀態（種子基線：18 項全部 GRANTED）
    await setKeywordReplyFeature(true);
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
  });

  /* ------------------------------------------------ 反向：閘門沒有被拆過頭 */

  it('自訂關鍵字寫入端點回 403（頁面因此把新增/編輯鎖住，與後端一致）', async () => {
    await setKeywordReplyFeature(false);
    const res = await api.post('/api/settings/line/keyword-replies', pagePayload({
      keyword: '整測未訂閱', matchType: 'EXACT', replyText: 'x',
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FEAT_001');
  });

  /* ------------------------------------------- 本輪最關鍵的一條（§8.16 ①） */

  /**
   * ⚠️ 前提變更（**不是**標準放寬）。本案例取代原本的
   *   「系統關鍵字的停用設定仍存得下來，但顧客端維持系統預設行為（頁面 subscribeNote 的原話）」
   * 那一條的斷言是 `expect(got).not.toBeNull()` ＋ `not.toBe(DEFAULT_REPLY)`
   * ——它釘住的是「未訂閱時停用**不**生效」，也就是 §8.16 裁掉的舊行為。
   * 舊行為既然被擁有者判定為錯的，釘著它的釘子當然要跟著改釘在新行為上。
   *
   * 新斷言的強度**高於**舊的：
   *   舊：只看 /v2/bot/message/reply 有沒有一則非 defaultReply 的回覆（單一路徑）。
   *   新：斷言 mock LINE 在整輪 webhook 裡收到的請求數 === 0，
   *       連 push / multicast 偷跑都會被抓到（message 事件不會呼叫
   *       GET /v2/bot/profile，那只在 follow 事件，所以「真的閉嘴」＝陣列為空）。
   *   而且逐一列舉該組的**全部**同義詞，不是只驗一個。
   */
  it('未訂閱也一律生效：停用該組後顧客打這些字 → mock LINE 零呼叫（bot 真的閉嘴）', async () => {
    await setKeywordReplyFeature(false);

    // 存得下來：PUT /api/settings/line 不擋 feature（頁面 saveLineSettings 走的那支）
    const res = await api.put('/api/settings/line', { systemKeywordGroupsDisabled: ['MENU'] });
    expect(res.status).toBe(200);
    const { data } = await admin
      .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
    expect((data!.line as any).systemKeywordGroupsDisabled).toEqual(['MENU']);

    // 而且**真的生效**：MENU 組三個同義詞，一則訊息都不准送出去
    for (const k of ['主選單', '選單', '功能']) {
      const calls = await lineCallsFor(k);
      expect(
        calls.map((c) => `${c.method} ${c.path}`),
        `未訂閱 + 已停用，顧客打「${k}」時 bot 仍對 LINE 發了請求（§8.16 要求閉嘴）`,
      ).toEqual([]);
    }

    // 「其他字不受影響」——沒被停用的組照常回應（證明不是整支 webhook 死掉了，
    // 也證明未訂閱本身不會讓系統關鍵字全部靜音）
    const other = await customerSays('優惠券');
    expect(other, '未停用的組也沒回應 ＝ webhook 整個壞了，不是停用生效').not.toBeNull();
    expect(other).not.toBe(DEFAULT_REPLY);
  }, 30_000);

  /* --------------------------------------------------------- 對照組（§8.16 ②） */

  /**
   * 對照組：**已訂閱**的租戶做同一件事必須得到同一個結果。
   * 沒有這一條，上面那條無法排除「改成只有未訂閱才生效」這種把閘門反過來裝的錯誤
   * ——那會是新的假成功換掉舊的（14 分冊 §6.5 的手法：凡是斷言「壞事沒發生」，
   * 都要配一個能區分『修好了』與『這條路根本沒被走到』的對照）。
   */
  it('對照組：已訂閱的租戶停用同一組 → 行為完全一致（同樣零呼叫，不是只有未訂閱才生效）', async () => {
    await setKeywordReplyFeature(true);
    await patchLineJsonb({ systemKeywordGroupsDisabled: ['MENU'] });

    for (const k of ['主選單', '選單', '功能']) {
      const calls = await lineCallsFor(k);
      expect(
        calls.map((c) => `${c.method} ${c.path}`),
        `已訂閱 + 已停用，顧客打「${k}」時 bot 仍有回應`,
      ).toEqual([]);
    }

    // 恢復（清空清單）→ 兩種訂閱狀態下都要回得來，證明停用是唯一變因
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
    expect(await customerSays('選單')).not.toBeNull();
    await setKeywordReplyFeature(false);
    expect(await customerSays('選單'), '未訂閱時恢復開關失效 ＝ 閘門偷偷還在').not.toBeNull();
  }, 30_000);
});
