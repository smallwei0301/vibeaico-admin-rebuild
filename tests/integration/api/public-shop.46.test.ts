/**
 * 公開店家頁 `/s/{shopCode}` 的端到端驗收（issue #46 第一片）
 * -----------------------------------------------------------------------------
 * ## 這一檔要證的是什麼
 *
 * 單元層（`tests/unit/public-shop-exposure.46.test.ts`）讀的是原始碼文字：select
 * 清單有沒有被放寬、閘門在不在。那些全部通過，仍然完全可能出現：
 *
 *   - 頁面根本沒接上那個 loader；
 *   - 接上了但 Next.js 的動態路由沒對到，訪客拿到 404；
 *   - 草稿行程實際上還是被渲染出來（例如 select 有閘門但頁面另外撈了一次）。
 *
 * 所以本檔一律**用真 HTTP 抓那一頁的 HTML**，然後對 HTML 本身斷言。
 *
 * ## ⚠️ 這是全站第一個不需登入的頁面，所以斷言的重點是「看不到什麼」
 *
 * 每一條「不該出現」的斷言都配一條「該出現」的對照組。否則頁面整個壞掉回 500 時，
 * 所有 `not.toContain()` 都會通過——那是一份看起來全綠、實際什麼都沒驗到的測試
 * （PB-029）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { encryptSecret } from '@/server/crypto';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = 'I46';

let admin: SupabaseClient;

/** A 店：一個已發布行程（含方案與未來團次）＋ 一個草稿行程 */
const TRIP_PUBLISHED = '74600000-0000-4000-8000-000000000001';
const TRIP_DRAFT = '74600000-0000-4000-8000-000000000002';
const PLAN_PUBLISHED = '74600000-0000-4000-8000-000000000011';
const DEP_FUTURE = '74600000-0000-4000-8000-000000000021';
const DEP_CANCELLED = '74600000-0000-4000-8000-000000000022';
const DEP_FULL = '74600000-0000-4000-8000-000000000023';
/** B 店的行程——用來證明它不會出現在 A 店的頁面上 */
const TRIP_OTHER_TENANT = '74600000-0000-4000-8000-0000000000b1';

const PUBLISHED_TITLE = `${TAG} 已發布的賞鯨行程`;
const DRAFT_TITLE = `${TAG} 還在草稿的祕密行程`;
const PLAN_NAME = `${TAG} 標準方案`;
const OTHER_TENANT_TITLE = `${TAG} B 店的行程`;

/**
 * ⚠️ 這一組值是本檔最重要的一條測試的**前置**，不是裝飾。
 *
 * 種子沒有替 SHOP_A 設 LINE 憑證：`line_channel_secret_enc` 與
 * `line_channel_access_token_enc` 都是空字串，`line` jsonb 是 `{}`。原本那條
 * 「頁面不含任何 LINE 祕密」因此在標準種子下**一個祕密都沒比對到**——迴圈裡的
 * `if (!secret) continue` 把兩次比對全跳過，只剩對照組在跑。名字宣稱的比證到的
 * 多，正是 PB-029。
 *
 * 所以這一版由測試自己寫入一組已知的密文與 `line` 設定（afterAll 還原快照），
 * 讓那條斷言真的有東西可以比對：`lineBasicId` **應該**出現在頁面上（它就是加好友
 * 連結），`channelId` 與兩段密文**都不該**出現。
 */
const LINE_BASIC_ID = '@i46test';
const LINE_CHANNEL_ID = 'I46-channel-id-should-not-be-public';
const LINE_SECRET = 'I46-channel-secret-should-not-be-public';
const LINE_TOKEN = 'I46-channel-access-token-should-not-be-public';

/** tenant_settings 快照（afterAll 還原用） */
let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

/** 未來的日期，避開「今天」的邊界問題 */
const FUTURE = '2028-06-15';
/** 取消的那一團另用一天，這樣它的日期字串本身就是唯一的判準 */
const FUTURE_CANCELLED = '2028-06-16';

async function html(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.text() };
}

/**
 * ⚠️ 每一次前置寫入都必須檢查 `error`。
 *
 * 這不是形式。第一次在 CI 跑這一檔時，三個 `upsert` **全部沒有生效**，而我把
 * `error` 丟掉了，於是 `beforeAll` 安靜地成功、測試才在斷言處才炸——錯誤訊息是
 * 「頁面上沒有 I46 已發布的賞鯨行程」，完全指不到真正的原因（前置根本沒寫進去）。
 *
 * 這正是 `src/server/public-shop.ts` 檔頭引用的 PB-023 同一個形狀，只是這次犯在
 * 測試檔上：丟掉 error 會讓「寫入失敗」冒充「東西不見了」。
 */
function mustWrite(label: string, result: { error: unknown }): void {
  if (result.error) {
    throw new Error(`前置寫入失敗（${label}）：${JSON.stringify(result.error)}`);
  }
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /**
   * ⚠️ 批次 upsert 的每一列**必須有完全相同的欄位集合**。
   *
   * 這是實跑抓到的坑，不是理論。原本只有第一列給了 `summary`，另外兩列沒給，於是：
   *
   *   PostgREST 把整批合成**一句** INSERT，欄位清單取所有列的**聯集**。`summary`
   *   因此進了欄位清單，沒給值的那兩列就被填成**明確的 NULL**——而不是走欄位預設。
   *   `trips.summary` 是 `not null default ''`，預設只在欄位被**省略**時生效，
   *   明確的 NULL 一樣違反 not-null → 整批 23502 失敗。
   *
   * 更糟的是當時我沒有檢查 `error`，所以三個 upsert 全部沒生效卻安靜通過，測試在
   * 六條斷言處才炸，訊息指向「頁面上沒有這個行程」——完全指不到真正的原因。
   *
   * 兩個教訓都寫在這裡：**批次的欄位集合要一致**，而且**每一次寫入都要檢查 error**。
   */
  // ---- SHOP_A：寫入一組已知的 LINE 設定與密文（先快照，afterAll 還原）----
  const snapshot = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  mustWrite('tenant_settings 快照', snapshot);
  settingsSnapshot = snapshot.data as typeof settingsSnapshot;
  mustWrite('tenant_settings 寫入 LINE 設定', await admin.from('tenant_settings').update({
    line: { lineBasicId: LINE_BASIC_ID, channelId: LINE_CHANNEL_ID },
    line_channel_secret_enc: encryptSecret(LINE_SECRET),
    line_channel_access_token_enc: encryptSecret(LINE_TOKEN),
  }).eq('tenant_id', SHOP_A.id));

  mustWrite('trips', await admin.from('trips').upsert([
    {
      id: TRIP_PUBLISHED, tenant_id: SHOP_A.id, title: PUBLISHED_TITLE,
      slug: `itest-46-pub-${Date.now()}`, status: 'PUBLISHED',
      duration_hours: 3, summary: `${TAG} 這段摘要應該看得到`,
    },
    {
      id: TRIP_DRAFT, tenant_id: SHOP_A.id, title: DRAFT_TITLE,
      slug: `itest-46-draft-${Date.now()}`, status: 'DRAFT',
      duration_hours: 3, summary: `${TAG} 草稿的摘要`,
    },
    {
      id: TRIP_OTHER_TENANT, tenant_id: SHOP_B.id, title: OTHER_TENANT_TITLE,
      slug: `itest-46-other-${Date.now()}`, status: 'PUBLISHED',
      duration_hours: 3, summary: `${TAG} B 店的摘要`,
    },
  ]));

  mustWrite('trip_plans', await admin.from('trip_plans').upsert({
    id: PLAN_PUBLISHED, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED,
    name: PLAN_NAME, price_per_person: 1800, min_party: 2, max_party: 8, active: true,
  }));

  /**
   * #362：這支一般 Product integration 的 fixture 只送 main 已存在的 departure 欄位。
   * shared TEST 若仍帶著 #41 overlay，overlay 自己的 trigger 會從 plan 補 candidate snapshot；
   * canonical core 沒有那些欄位也照樣能建立同一批測試資料。這樣綠燈不再依賴 TEST 超前 main。
   *
   * 「已過期團次」仍無法用寫入穩定製造：#41 overlay 的 deadline trigger 會阻擋過期值，
   * core 與 overlay 又必須共用同一套斷言。因此 `.gte('departs_on', 台北今天)` 由
   * `tests/unit/public-shop-exposure.46.test.ts` 鎖住；這裡改驗同一查詢裡可真實製造的
   * CANCELLED 與額滿負例，不用候選欄位換一份假完整覆蓋。
   */
  mustWrite('trip_departures', await admin.from('trip_departures').upsert([
    // 未來、有空位 → 應該出現
    {
      id: DEP_FUTURE, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: FUTURE, start_time: '09:00', capacity: 8, seats_booked: 3, status: 'OPEN',
    },
    // 已取消 → 不該出現（顧客看到一團已經取消的行程只會白跑）
    {
      id: DEP_CANCELLED, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: FUTURE_CANCELLED, start_time: '09:00', capacity: 8, seats_booked: 0,
      status: 'CANCELLED',
    },
    // 未來但已額滿 → 不該出現（列一個買不到的團次只會讓顧客白跑）
    {
      id: DEP_FULL, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: FUTURE, start_time: '14:00', capacity: 4, seats_booked: 4, status: 'OPEN',
    },
  ]));

  /**
   * ⚠️ 讀回來核實，不信「沒有 error 就等於寫進去了」。
   *
   * `upsert` 可能因為 on-conflict 解析而變成一次無聲的 no-op；那種情況下 error 是
   * null，但資料庫裡什麼都沒有。前置沒成立卻讓測試繼續跑下去，就會產生一份指著
   * 錯誤方向的失敗訊息（或更糟——一份全綠但什麼都沒驗到的報告，PB-029）。
   */
  const seeded = await admin.from('trips')
    .select('id, status').in('id', [TRIP_PUBLISHED, TRIP_DRAFT, TRIP_OTHER_TENANT]);
  mustWrite('trips 讀回核實', seeded);
  expect(
    (seeded.data ?? []).map((r) => r.id).sort(),
    '前置寫入沒有 error，但資料庫裡讀不回這三筆行程',
  ).toEqual([TRIP_PUBLISHED, TRIP_DRAFT, TRIP_OTHER_TENANT].sort());

  const seededDepartures = await admin.from('trip_departures')
    .select('id').in('id', [DEP_FUTURE, DEP_CANCELLED, DEP_FULL]);
  mustWrite('trip_departures 讀回核實', seededDepartures);
  expect((seededDepartures.data ?? []).length, '前置的三筆團次沒有全部寫進去').toBe(3);
});

afterAll(async () => {
  // 只刪自己造的：整表 delete 會清掉別的測試檔的前置資料。
  await admin.from('trip_departures').delete().in('id', [DEP_FUTURE, DEP_CANCELLED, DEP_FULL]);
  await admin.from('trip_plans').delete().eq('id', PLAN_PUBLISHED);
  await admin.from('trips').delete().in('id', [TRIP_PUBLISHED, TRIP_DRAFT, TRIP_OTHER_TENANT]);
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line ?? {},
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
});

describe('公開店家頁真的打得開', () => {
  it('未登入即可取得 A 店的頁面（200），且看得到已發布行程與方案', async () => {
    // ⚠️ 這一條是後面所有 not.toContain 的前提：頁面真的渲染出來了。
    const { status, body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(status).toBe(200);
    expect(body).toContain(PUBLISHED_TITLE);
    expect(body).toContain(PLAN_NAME);
  });

  it('不存在的店家代碼 → 404，而不是一個空白頁', async () => {
    const { status } = await html(`/s/no-such-shop-${randomUUID().slice(0, 8)}`);
    expect(status).toBe(404);
  });
});

describe('看不到什麼（每一條都有對照組）', () => {
  it('草稿行程不出現，但同一頁的已發布行程出現', async () => {
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain(PUBLISHED_TITLE);   // 對照組
    expect(body).not.toContain(DRAFT_TITLE);
  });

  it('別家店的行程不出現在這一頁', async () => {
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain(PUBLISHED_TITLE);   // 對照組
    expect(body).not.toContain(OTHER_TENANT_TITLE);

    // 反向也驗一次：B 店的頁面看得到自己的、看不到 A 店的。
    const other = await html(`/s/${SHOP_B.shopCode}`);
    expect(other.status).toBe(200);
    expect(other.body).toContain(OTHER_TENANT_TITLE);
    expect(other.body).not.toContain(PUBLISHED_TITLE);
  });

  it('已取消與已額滿的團次不出現，但未來有空位的出現', async () => {
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    // 對照組：未來有空位的那一團（2028-06-15 是週四、8 席已訂 3 → 剩 5 位）
    //
    // ⚠️ 用完整的 `M/D（週X）` 字串，不用裸的 `6/15`。共用 TEST 上還有別的測試檔與
    // 種子資料造的團次，裸日期太容易與它們巧合相撞——那會讓這幾條斷言在某些日子
    // 誤紅或誤綠，而兩種都比沒有這條測試糟。
    expect(body).toContain('6/15（四）');
    expect(body).toContain('剩 5 位');
    // 已取消的那一團是 2028-06-16（週五）——整個日期都不該出現在頁面上
    expect(body).not.toContain('6/16（五）');
    // 已額滿那一團是 6/15 的 14:00；剩 0 位不該出現
    expect(body).not.toContain('剩 0 位');
  });

  it('⚠️ 頁面帶出 lineBasicId，但不含 channelId 或任何密文', async () => {
    /**
     * 這是本檔最重要的一條。`tenant_settings(basic, line)` 會把**整個** line jsonb
     * 撈進伺服器記憶體（PostgREST 無法只取 jsonb 的某個 key），擋住它的只有 loader
     * 自己那一行 `settings?.line?.lineBasicId`。若哪天有人把整個 settings 物件往
     * 頁面送，這一條會紅。
     *
     * ⚠️ 前置已經寫入一組**已知**的密文與 `channelId`，所以下面每一條 `not.toContain`
     * 都真的有東西在比對。先前的版本依賴種子裡的值，而種子那兩欄是空字串，於是整條
     * 測試只跑了對照組——看起來很嚴謹、實際零比對（PB-029）。
     */
    const { data: settings, error } = await admin.from('tenant_settings')
      .select('line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', SHOP_A.id).single();
    expect(error).toBeNull();

    const cipherSecret = settings!.line_channel_secret_enc as string;
    const cipherToken = settings!.line_channel_access_token_enc as string;
    // 對照組之一：前置真的寫進去了，密文不是空字串（空字串用 toContain 會恆真）。
    expect(cipherSecret.length, '前置沒有寫入 channel secret 密文').toBeGreaterThan(8);
    expect(cipherToken.length, '前置沒有寫入 access token 密文').toBeGreaterThan(8);

    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain(PUBLISHED_TITLE);   // 對照組之二：頁面真的渲染出來了
    // 對照組之三：lineBasicId **應該**在頁面上——它就是加好友連結。
    // 這一條同時證明 loader 真的讀得到 line 那一塊，所以下面的「讀不到密文」不是
    // 因為整塊 line 沒被撈出來而恰好成立。
    expect(body).toContain(LINE_BASIC_ID.replace('@', '%40'));

    expect(body, 'channelId 出現在公開頁上').not.toContain(LINE_CHANNEL_ID);
    expect(body, 'channel secret 明文出現在公開頁上').not.toContain(LINE_SECRET);
    expect(body, 'access token 明文出現在公開頁上').not.toContain(LINE_TOKEN);
    expect(body, 'channel secret 密文出現在公開頁上').not.toContain(cipherSecret);
    expect(body, 'access token 密文出現在公開頁上').not.toContain(cipherToken);
  });

  it('⚠️ 頁面不含顧客個資', async () => {
    const { data: customers } = await admin.from('customers')
      .select('name, phone').eq('tenant_id', SHOP_A.id).limit(3);
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain(PUBLISHED_TITLE);   // 對照組

    for (const customer of customers ?? []) {
      if (customer.phone && customer.phone.length >= 8) {
        expect(body, `顧客電話 ${customer.phone} 出現在公開頁上`).not.toContain(customer.phone);
      }
    }
    expect(customers?.length ?? 0).toBeGreaterThan(0); // 對照組：真的有顧客可以比對
  });
});

describe('這一版誠實地說明「還不能線上下單」', () => {
  it('頁面說明要怎麼預約，且沒有任何表單或送出按鈕', async () => {
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain('線上直接下單功能正在準備中');
    // 付款鏈（#12／#32）還沒建；一顆按了沒反應的「立即預約」比沒有按鈕糟得多。
    expect(body).not.toContain('立即預約');
    expect(body).not.toMatch(/<form[\s>]/);
  });
});
