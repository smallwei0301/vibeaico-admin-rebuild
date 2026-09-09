/**
 * 後台小幫手真的查得到東西 — `POST /api/support-chat/ask`
 * -----------------------------------------------------------------------------
 * 修好前的病：`SupportChatWidget` 掛在**後台每一頁**上，開場白宣稱「可以幫您查
 * LINE 狀態、推播額度、最近異常日誌，或回答後台使用問題」，而 `send()` 只把訊息
 * append 到本地 state 就結束——沒有端點、沒有回覆、永遠不會有。
 *
 * 單元層守的是規則本身；本檔打真端點、直查 DB，守的是「查到的真的是這家店的
 * 真實資料」：
 *   1. 推播額度：先把 `push_quota_usage` 寫成一個已知值，端點回的數字要對得上
 *      （**不是**回一個看起來合理的預設值）
 *   2. LINE 狀態：憑證欄位真的有值 → 回「已設定」；把 token 清空 → 同一支端點
 *      改口說「尚未設定」，且該項標為 warning（對照組，證明它真的在讀 DB）
 *   3. ⚠️ 回覆內容裡不含任何密文——測試自己寫入一段**已知**密文再比對，
 *      而不是「grep 不到就算過」（沒有已知值可比對的否定斷言證不到任何事）
 *   4. 跨租戶：B 店問同一句話，拿到的是 B 店自己的數字，不是 A 店的
 *   5. STAFF 也用得到（唯讀查詢不該要 MANAGER）
 *   6. 判不出來的問題回 UNSUPPORTED，且不夾帶任何店家數字
 *   7. 空問題 / 超長問題被 zod 擋成 400 REQ_001
 *
 * 清理紀律：afterAll 把 `push_quota_usage` 與 `tenant_settings` 還原成 beforeAll
 * 拍下的快照；本檔不建立任何新的租戶或使用者。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const PATH = '/api/support-chat/ask';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
interface Answer {
  intent: string;
  answer: string;
  facts: { label: string; value: string; warning?: boolean }[];
  links: { label: string; href: string }[];
}

const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

/** 台北時間的 YYYY-MM，與 `src/server/tz.ts` 的 `taipeiCurrentMonthKey()` 同一個定義。 */
const taipeiMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);

/** 只有這一支測試會用到的可辨識密文，用來證明「回覆裡沒有密文」是真的比對過。 */
const KNOWN_CIPHERTEXT = 'itest-support-chat-known-ciphertext-0001';

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let staffA: AuthedApi;
const month = taipeiMonth();

let settingsSnapshotA: Record<string, unknown> | null = null;
let quotaSnapshotA: number | null = null;
let quotaRowExistedA = false;

const ask = async (api: AuthedApi, question: string) =>
  api.post(PATH, { question });

beforeAll(async () => {
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  [ownerA, ownerB, staffA] = await Promise.all([
    loginAs(SHOP_A.owner.email, SHOP_A.owner.password),
    loginAs(SHOP_B.owner.email, SHOP_B.owner.password),
    loginAs(STAFF_A2.email, STAFF_A2.password),
  ]);

  const { data: settings } = await admin
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', SHOP_A.id)
    .maybeSingle();
  settingsSnapshotA = (settings ?? null) as Record<string, unknown> | null;

  const { data: quota } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', month)
    .maybeSingle();
  quotaRowExistedA = Boolean(quota);
  quotaSnapshotA = quota?.used ?? null;
});

afterAll(async () => {
  if (!admin) return;
  if (settingsSnapshotA) {
    await admin.from('tenant_settings').upsert(settingsSnapshotA, { onConflict: 'tenant_id' });
  }
  if (quotaRowExistedA) {
    await admin
      .from('push_quota_usage')
      .upsert({ tenant_id: SHOP_A.id, month, used: quotaSnapshotA ?? 0 });
  } else {
    await admin.from('push_quota_usage').delete().eq('tenant_id', SHOP_A.id).eq('month', month);
  }
});

/**
 * ⚠️ 上限**不寫死**。標準種子給 A、B 兩店都訂了 `EXTRA_PUSH`（`scripts/test/seed.mjs:189`），
 * 所以上限是 700 不是 200。第一版把 200 寫死，在隔離庫上三條轉紅——那是測試的
 * 假設錯，不是端點錯。改成「從 DB 讀這家店真正的 EXTRA_PUSH 狀態算出應有的上限，
 * 再據以驗算」：既不依賴種子的某個版本，也真的驗到了「200／700 二選一」這條規則。
 */
const expectedLimitFor = async (tenantId: string) => {
  const { data } = await admin
    .from('feature_subscriptions')
    .select('active, expires_at')
    .eq('tenant_id', tenantId)
    .eq('code', 'EXTRA_PUSH')
    .maybeSingle();
  const live =
    Boolean(data?.active) && (!data?.expires_at || new Date(data.expires_at as string) > new Date());
  return live ? 700 : 200;
};

describe('推播額度：回的是 DB 裡那個數字，不是預設值', () => {
  it('上限依這家店真正的 EXTRA_PUSH 訂閱決定（200／700 二選一）', async () => {
    const limit = await expectedLimitFor(SHOP_A.id);
    const body = await readJson<Answer>(await ask(ownerA, '推播額度'));
    const facts = Object.fromEntries((body.data?.facts ?? []).map((f) => [f.label, f.value]));
    expect(facts['本月上限']).toBe(`${limit} 則`);
    expect([200, 700]).toContain(limit);
  });

  it('把本月用量寫成「上限 − 63」→ 端點回的已用與剩餘都對得上', async () => {
    const limit = await expectedLimitFor(SHOP_A.id);
    const used = limit - 63;
    await admin.from('push_quota_usage').upsert({ tenant_id: SHOP_A.id, month, used });

    const res = await ask(ownerA, '本月推播額度還剩多少？');
    expect(res.status).toBe(200);
    const body = await readJson<Answer>(res);
    expect(body.success).toBe(true);
    expect(body.data?.intent).toBe('PUSH_QUOTA');
    const facts = Object.fromEntries((body.data?.facts ?? []).map((f) => [f.label, f.value]));
    expect(facts['本月已用']).toBe(`${used} 則`);
    expect(facts['剩餘']).toBe('63 則');
    expect(facts['統計月份（台北時間）']).toBe(month);
    expect(body.data?.answer).toContain('63');
  });

  it('對照組：用滿上限 → 同一支端點改口說已經用完，剩餘標為 warning', async () => {
    const limit = await expectedLimitFor(SHOP_A.id);
    await admin.from('push_quota_usage').upsert({ tenant_id: SHOP_A.id, month, used: limit });

    const body = await readJson<Answer>(await ask(ownerA, '推播額度'));
    expect(body.data?.answer).toContain('已經用完');
    expect(body.data?.facts.find((f) => f.label === '剩餘')?.warning).toBe(true);
  });

  it('跨租戶：A 店用滿、B 店歸零 → B 店拿到的是 B 店自己的數字', async () => {
    const limitA = await expectedLimitFor(SHOP_A.id);
    const limitB = await expectedLimitFor(SHOP_B.id);
    await admin.from('push_quota_usage').upsert({ tenant_id: SHOP_A.id, month, used: limitA });
    await admin.from('push_quota_usage').delete().eq('tenant_id', SHOP_B.id).eq('month', month);

    const body = await readJson<Answer>(await ask(ownerB, '推播額度'));
    const facts = Object.fromEntries((body.data?.facts ?? []).map((f) => [f.label, f.value]));
    expect(facts['本月已用']).toBe('0 則');
    expect(facts['剩餘']).toBe(`${limitB} 則`);
    expect(body.data?.answer).not.toContain('已經用完');
  });
});

describe('LINE 狀態：真的在讀 tenant_settings', () => {
  it('憑證齊全 → 說可以收發訊息，且沒有任何一項是 warning', async () => {
    await admin.from('tenant_settings').upsert(
      {
        tenant_id: SHOP_A.id,
        line: { ...(settingsSnapshotA?.line as object), channelId: '2010395749' },
        line_channel_secret_enc: KNOWN_CIPHERTEXT,
        line_channel_access_token_enc: KNOWN_CIPHERTEXT,
      },
      { onConflict: 'tenant_id' },
    );

    const body = await readJson<Answer>(await ask(ownerA, 'LINE 串接好了嗎？'));
    expect(body.data?.intent).toBe('LINE_STATUS');
    expect(body.data?.answer).toContain('可以收發訊息');
    expect(body.data?.facts.some((f) => f.warning)).toBe(false);
    expect(body.data?.facts.find((f) => f.label === 'Webhook 網址')?.value).toContain(
      `/api/line/webhook/${SHOP_A.shopCode}`,
    );
  });

  it('⚠️ 回覆裡不含那段已知密文（對照組：DB 裡真的有它）', async () => {
    const { data } = await admin
      .from('tenant_settings')
      .select('line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', SHOP_A.id)
      .maybeSingle();
    // 對照組：先證明比對得到的目標真的存在，否則下面的否定斷言證不到任何事。
    expect(data?.line_channel_secret_enc).toBe(KNOWN_CIPHERTEXT);
    expect(data?.line_channel_access_token_enc).toBe(KNOWN_CIPHERTEXT);

    const res = await ask(ownerA, 'LINE 設定');
    const raw = await res.text();
    expect(raw).not.toContain(KNOWN_CIPHERTEXT);
  });

  it('對照組：把 access token 清成空字串 → 同一支端點改口說不會有反應，該項標 warning', async () => {
    // ⚠️ 清成**空字串**而不是 null：`0003_tenants_and_accounts.sql:29-30` 把這兩欄
    // 定義成 `text not null default ''`，「未設定」的實際樣子是空字串。第一版寫成
    // `.update({ …: null })` 會撞 not-null 而整筆不生效，端點於是照樣說「已設定」——
    // 那不是端點錯，是這條對照組沒真的把狀態改掉。
    const { error } = await admin
      .from('tenant_settings')
      .update({ line_channel_access_token_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();

    const body = await readJson<Answer>(await ask(ownerA, 'LINE 綁定狀態'));
    expect(body.data?.answer).toContain('不會有反應');
    expect(body.data?.facts.find((f) => f.label === 'Channel Access Token')?.warning).toBe(true);
  });

  it('⚠️ 從沒設定過 LINE 的店（兩欄都是預設空字串）不得被告知「都已設定」', async () => {
    // 這一條守的是本 PR 在隔離庫上被抓到的真缺陷：判準原本寫成 `is not null`，
    // 而欄位是 `not null default ''`，於是每一家店都會被回「憑證三項都已設定，
    // 機器人可以收發訊息」——把一則假成功修成另一則假成功。
    const { error } = await admin
      .from('tenant_settings')
      .update({ line_channel_secret_enc: '', line_channel_access_token_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();

    const body = await readJson<Answer>(await ask(ownerA, 'LINE 串接狀態'));
    expect(body.data?.answer).toContain('不會有反應');
    const byLabel = Object.fromEntries(
      (body.data?.facts ?? []).map((f) => [f.label, f]),
    );
    expect(byLabel['Channel Secret'].value).toBe('尚未設定');
    expect(byLabel['Channel Secret'].warning).toBe(true);
    expect(byLabel['Channel Access Token'].value).toBe('尚未設定');
    expect(byLabel['Channel Access Token'].warning).toBe(true);
  });
});

describe('權限與輸入邊界', () => {
  it('STAFF 也查得到（唯讀查詢不該要 MANAGER）', async () => {
    const res = await ask(staffA, '推播額度');
    expect(res.status).toBe(200);
    expect((await readJson<Answer>(res)).data?.intent).toBe('PUSH_QUOTA');
  });

  it('未登入 → 401', async () => {
    const res = await fetch(`${process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100'}${PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '推播額度' }),
    });
    expect(res.status).toBe(401);
  });

  it('判不出來的問題 → UNSUPPORTED，且不夾帶任何店家數字', async () => {
    const body = await readJson<Answer>(await ask(ownerA, '我要退款怎麼辦'));
    expect(body.data?.intent).toBe('UNSUPPORTED');
    expect(body.data?.facts).toHaveLength(0);
  });

  it('空問題 → 400 REQ_001', async () => {
    const res = await ask(ownerA, '   ');
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('超過 500 字 → 400 REQ_001', async () => {
    const res = await ask(ownerA, '推播'.repeat(300));
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });
});
