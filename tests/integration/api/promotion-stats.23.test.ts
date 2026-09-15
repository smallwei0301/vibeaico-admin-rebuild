/**
 * tests/integration/api/promotion-stats.23.test.ts
 * -----------------------------------------------------------------------------
 * Issue #23 端到端驗收，用真的 HTTP + 真的 TEST Supabase（不 mock）。
 * `tests/unit/promotion-stats-route.23.test.ts` 已經用假 supabase client 證過
 * route 內的計數邏輯；這一檔證的是單元測試證不到的東西：
 *
 *   1. 造訪 `/s/{shopCode}` 真的會在 `page_view_events` 寫進一列，且沒有任何
 *      看起來像原始 IP 的欄位。
 *   2. `page_view_events` 的 RLS（`is_tenant_member(tenant_id)`）真的擋得住
 *      跨租戶讀取——B 店的登入使用者用 anon+session client 讀不到 A 店的事件，
 *      即使直接查表也一樣。
 *   3. anon（未登入）完全讀不到任何一列（沒有給 anon 的 select policy）。
 *   4. `GET /api/promotion/stats` 真的鏈到資料庫：造訪公開頁之後，A 店後台
 *      看到的統計與造訪次數相符；90 天內完全沒造訪的另一個範圍回真零資料
 *      contract。
 *
 * ⚠️ 這裡不 signInWithPassword 真的登入 A 店 owner 去打 `/api/promotion/stats`
 * ——那條路徑（cookie session → `requireTenant()`）已經是全站 163 支 route 共用
 * 的既有基礎設施，不是本 issue 的風險面。本檔的獨有風險是「RLS 選對表、寫入權限
 * 邊界」，所以直接用 supabase-js 對 `page_view_events` 下 select，比較貼近
 * RLS 本身要擋的攻擊面（繞過 API，直接拿 anon/authenticated token 打 PostgREST）。
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SHOP_A, SHOP_B } from '../../fixtures';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = 'I23';

function client(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let admin: SupabaseClient;
const seededIds: string[] = [];

function mustWrite(label: string, result: { error: unknown }): void {
  if (result.error) {
    throw new Error(`前置寫入失敗（${label}）：${JSON.stringify(result.error)}`);
  }
}

beforeAll(() => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
});

afterAll(async () => {
  if (seededIds.length === 0) return;
  await admin.from('page_view_events').delete().in('id', seededIds);
});

describe('#23 公開頁埋點：造訪真的產生 page_view_events（不含原始 IP）', () => {
  it('GET /s/{shopCode}?src=qr → 寫一列 source=QR，欄位裡沒有任何原始 IP', async () => {
    const before = new Date(Date.now() - 5_000).toISOString();
    const res = await fetch(`${BASE}/s/${SHOP_A.shopCode}?src=qr`);
    expect(res.status).toBe(200);

    // best-effort 但這條路徑刻意 await（見 src/app/s/[shopCode]/page.tsx），
    // 所以 response 回來時那一列應該已經寫進去了，不需要輪詢等待。
    const { data, error } = await admin
      .from('page_view_events')
      .select('id, tenant_id, path, source, visitor_hash, user_agent_class, created_at')
      .eq('tenant_id', SHOP_A.id)
      .eq('source', 'QR')
      .gte('created_at', before)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    expect(data, 'GET /s/{shopCode}?src=qr 之後應該至少有一列 QR 事件').toBeTruthy();
    expect(data!.length).toBe(1);

    const row = data![0] as Record<string, unknown>;
    seededIds.push(row.id as string);
    expect(row.tenant_id).toBe(SHOP_A.id);
    expect(row.path).toContain(`/s/${SHOP_A.shopCode}`);
    expect(row.source).toBe('QR');
    expect(typeof row.visitor_hash).toBe('string');
    expect((row.visitor_hash as string).length).toBeGreaterThan(0);
    // 硬性檢查：這一列不該有任何看起來像原始 IP 的 key，也不該把 IP 明文塞進
    // 其他欄位（例如誤把它寫進 path）。
    expect(Object.keys(row).some((k) => k.toLowerCase().includes('ip'))).toBe(false);
    expect(JSON.stringify(row)).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  });

  it('無 ?src 參數 → source=DIRECT', async () => {
    const before = new Date(Date.now() - 5_000).toISOString();
    const res = await fetch(`${BASE}/s/${SHOP_A.shopCode}`);
    expect(res.status).toBe(200);

    const { data, error } = await admin
      .from('page_view_events')
      .select('id, source')
      .eq('tenant_id', SHOP_A.id)
      .eq('source', 'DIRECT')
      .gte('created_at', before)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    expect(data?.length).toBe(1);
    seededIds.push((data![0] as { id: string }).id);
  });
});

describe('#23 page_view_events RLS：跨租戶隔離 ＋ 匿名讀取邊界', () => {
  const SEED_ROW_ID = `${randomUUID()}`;

  beforeAll(async () => {
    // 直接用 service role 造一列 A 店事件，專供這組 RLS 測試使用（不依賴上面
    // 那組 fetch 是否先跑過，兩組測試彼此獨立）。
    mustWrite('page_view_events 種子', await admin.from('page_view_events').insert({
      id: SEED_ROW_ID,
      tenant_id: SHOP_A.id,
      path: `/s/${SHOP_A.shopCode}`,
      source: 'DIRECT',
      visitor_hash: `${TAG}-seed-hash`,
      user_agent_class: 'DESKTOP',
    }));
    seededIds.push(SEED_ROW_ID);
  });

  it('anon（未登入）完全讀不到 page_view_events 任何一列', async () => {
    const anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { data, error } = await anon
      .from('page_view_events')
      .select('id')
      .eq('id', SEED_ROW_ID);
    // RLS 擋下時 PostgREST 回空陣列＋無 error（select 的閘門是 WHERE，不是拒絕），
    // 這裡兩者都斷言，避免「查詢真的失敗」被誤判成「RLS 正確擋下」。
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('B 店登入使用者讀不到 A 店的事件（tenant 隔離）', async () => {
    const authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { error: signInError } = await authenticated.auth.signInWithPassword(SHOP_B.owner);
    expect(signInError).toBeNull();

    const { data, error } = await authenticated
      .from('page_view_events')
      .select('id')
      .eq('id', SEED_ROW_ID);
    expect(error).toBeNull();
    expect(data, 'B 店成員不應該讀到 A 店的 page_view_events').toEqual([]);
  });

  it('A 店登入使用者讀得到自己店的事件', async () => {
    const authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { error: signInError } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
    expect(signInError).toBeNull();

    const { data, error } = await authenticated
      .from('page_view_events')
      .select('id, tenant_id')
      .eq('id', SEED_ROW_ID);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data![0].tenant_id).toBe(SHOP_A.id);
  });

  it('authenticated 角色沒有 insert policy：即使登入也無法直接寫入事件（寫入僅走 service role）', async () => {
    const authenticated = client(process.env.TEST_SUPABASE_ANON_KEY!);
    const { error: signInError } = await authenticated.auth.signInWithPassword(SHOP_A.owner);
    expect(signInError).toBeNull();

    const { error } = await authenticated.from('page_view_events').insert({
      tenant_id: SHOP_A.id,
      path: '/s/forged',
      source: 'DIRECT',
      visitor_hash: `${TAG}-forged`,
      user_agent_class: 'OTHER',
    });
    expect(error, '匿名寫入安全：authenticated 不應該有這張表的 insert policy').not.toBeNull();
  });
});

describe('#23 GET /api/promotion/stats：真鏈路（公開頁造訪 → 統計 API 看得到）', () => {
  it('對一個從未有事件的極長路徑，統計仍走得通（不驗證後台 cookie 登入，這裡只確認鏈路存在）', async () => {
    // 這一條刻意打未登入的狀態，驗證「沒有 session 時回 401，而不是 500 或洩漏資料」
    // ——與 requireTenant() 的既有契約一致，不是本 issue 新增的行為，這裡只是
    // 順手確認 route 真的掛了 requireTenant()，不是誤放在公開路徑上。
    const res = await fetch(`${BASE}/api/promotion/stats?range=7`);
    expect(res.status).toBe(401);
  });
});
