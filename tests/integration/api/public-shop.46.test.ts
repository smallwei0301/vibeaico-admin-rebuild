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

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = 'I46';

let admin: SupabaseClient;

/** A 店：一個已發布行程（含方案與未來團次）＋ 一個草稿行程 */
const TRIP_PUBLISHED = '74600000-0000-4000-8000-000000000001';
const TRIP_DRAFT = '74600000-0000-4000-8000-000000000002';
const PLAN_PUBLISHED = '74600000-0000-4000-8000-000000000011';
const DEP_FUTURE = '74600000-0000-4000-8000-000000000021';
const DEP_PAST = '74600000-0000-4000-8000-000000000022';
const DEP_FULL = '74600000-0000-4000-8000-000000000023';
/** B 店的行程——用來證明它不會出現在 A 店的頁面上 */
const TRIP_OTHER_TENANT = '74600000-0000-4000-8000-0000000000b1';

const PUBLISHED_TITLE = `${TAG} 已發布的賞鯨行程`;
const DRAFT_TITLE = `${TAG} 還在草稿的祕密行程`;
const PLAN_NAME = `${TAG} 標準方案`;
const OTHER_TENANT_TITLE = `${TAG} B 店的行程`;

/** 未來／過去的日期，避開「今天」的邊界問題 */
const FUTURE = '2028-06-15';
const PAST = '2020-01-15';

async function html(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.text() };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await admin.from('trips').upsert([
    {
      id: TRIP_PUBLISHED, tenant_id: SHOP_A.id, title: PUBLISHED_TITLE,
      slug: `itest-46-pub-${Date.now()}`, status: 'PUBLISHED', duration_hours: 3,
      summary: `${TAG} 這段摘要應該看得到`,
    },
    {
      id: TRIP_DRAFT, tenant_id: SHOP_A.id, title: DRAFT_TITLE,
      slug: `itest-46-draft-${Date.now()}`, status: 'DRAFT',
    },
    {
      id: TRIP_OTHER_TENANT, tenant_id: SHOP_B.id, title: OTHER_TENANT_TITLE,
      slug: `itest-46-other-${Date.now()}`, status: 'PUBLISHED',
    },
  ]);

  await admin.from('trip_plans').upsert({
    id: PLAN_PUBLISHED, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED,
    name: PLAN_NAME, price_per_person: 1800, min_party: 2, max_party: 8, active: true,
  });

  /**
   * ⚠️ `min_to_depart_snapshot` 是 not-null 且**沒有預設值**（本機以真 schema 逐欄
   * 查證）。走 API 建立時它由既有機制填入，但本檔是用 service role 直接 insert，
   * 少了它會 23502——今天已經在 #37 的前置上踩過同一個形狀一次（漏了
   * `bookings.booking_no` / `duration_minutes`）。
   */
  await admin.from('trip_departures').upsert([
    // 未來、有空位 → 應該出現
    {
      id: DEP_FUTURE, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: FUTURE, start_time: '09:00', capacity: 8, seats_booked: 3, status: 'OPEN',
      min_to_depart_snapshot: 2,
    },
    // 已經過去 → 不該出現
    {
      id: DEP_PAST, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: PAST, start_time: '09:00', capacity: 8, seats_booked: 0, status: 'OPEN',
      min_to_depart_snapshot: 2,
    },
    // 未來但已額滿 → 不該出現（列一個買不到的團次只會讓顧客白跑）
    {
      id: DEP_FULL, tenant_id: SHOP_A.id, trip_id: TRIP_PUBLISHED, plan_id: PLAN_PUBLISHED,
      departs_on: FUTURE, start_time: '14:00', capacity: 4, seats_booked: 4, status: 'OPEN',
      min_to_depart_snapshot: 2,
    },
  ]);
});

afterAll(async () => {
  // 只刪自己造的：整表 delete 會清掉別的測試檔的前置資料。
  await admin.from('trip_departures').delete().in('id', [DEP_FUTURE, DEP_PAST, DEP_FULL]);
  await admin.from('trip_plans').delete().eq('id', PLAN_PUBLISHED);
  await admin.from('trips').delete().in('id', [TRIP_PUBLISHED, TRIP_DRAFT, TRIP_OTHER_TENANT]);
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

  it('已過期與已額滿的團次不出現，但未來有空位的出現', async () => {
    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    // 對照組：未來有空位的那一團（6/15、剩 5 位）
    expect(body).toContain('6/15');
    expect(body).toContain('剩 5 位');
    // 已過期的那一團是 2020-01-15 → 1/15
    expect(body).not.toContain('1/15');
    // 已額滿那一團是同一天的 14:00；剩 0 位不該出現
    expect(body).not.toContain('剩 0 位');
  });

  it('⚠️ 頁面不含任何 LINE 祕密', async () => {
    // 這是本檔最重要的一條：`tenant_settings(basic, line)` 會把整個 line jsonb 撈進
    // 伺服器記憶體，只有 loader 自己的欄位挑選擋住它。若哪天有人把整個 settings
    // 物件往頁面送，這一條會紅。
    const { data: settings } = await admin.from('tenant_settings')
      .select('line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', SHOP_A.id).maybeSingle();

    const { body } = await html(`/s/${SHOP_A.shopCode}`);
    expect(body).toContain(PUBLISHED_TITLE);   // 對照組

    for (const secret of [
      settings?.line_channel_secret_enc,
      settings?.line_channel_access_token_enc,
    ]) {
      // 種子沒設 LINE 時這兩欄可能是空字串——空字串用 toContain 會恆真，跳過。
      if (!secret || secret.length < 8) continue;
      expect(body).not.toContain(secret);
    }
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
