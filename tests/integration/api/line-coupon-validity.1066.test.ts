/**
 * issue #1066 — LINE「票券」回覆的有效期篩選（真實 PostgREST）
 * -----------------------------------------------------------------------------
 * 單元測試 `tests/unit/line-coupon-reply.1066.test.ts` 用 fake client 自己解析 or 字串，
 * 沒經過真實 PostgREST。這一檔直接呼叫實際匯出的 `replyCoupons()`（src/server/line-events.ts
 * 的 `.or('start_at.is.null,start_at.lte.<ISO>')` + `.or('end_at.is.null,end_at.gt.<ISO>')`），
 * 用 TEST Supabase 證明：
 *   1. 兩段 .or() 以 AND 結合（兩段都要成立才出現）；
 *   2. 含 `:` 與 `Z` 的 ISO 時間在 PostgREST filter 中被正確解析；
 *   3. 半開區間 [start_at, end_at)。
 * 只攔截 LINE reply API（/v2/bot/message/reply，不論 LINE_API_BASE）的 fetch 以取得回覆文字；Supabase 請求原樣放行。
 * 專屬測試 tenant，afterAll 刪除 tenant（coupons 為 on delete cascade）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { replyCoupons } from '@/server/line-events';

let admin: SupabaseClient;
let tenantId = '';
const realFetch = globalThis.fetch;
const sent: string[] = [];

const T = 'itest-1066';
const NAME = {
  open: `${T}-無期限`,
  window: `${T}-區間內`,
  future: `${T}-尚未開始`,
  past: `${T}-已結束`,
  justExpired: `${T}-剛過期1秒`,
} as const;

beforeAll(async () => {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY');
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const id = randomUUID();
  const suffix = id.replaceAll('-', '').slice(0, 20);
  const ins = await admin.from('tenants').insert({ id, shop_code: `c1066-${suffix}`, name: `itest 1066 ${suffix}` });
  expect(ins.error).toBeNull();
  tenantId = id;

  const now = Date.now();
  const iso = (ms: number) => new Date(now + ms).toISOString();
  const DAY = 86_400_000;
  const base = { tenant_id: tenantId, status: 'PUBLISHED', discount_type: 'AMOUNT', discount_value: 100 };
  const rows = [
    { ...base, name: NAME.open, start_at: null, end_at: null },
    { ...base, name: NAME.window, start_at: iso(-DAY), end_at: iso(DAY) },
    { ...base, name: NAME.future, start_at: iso(DAY), end_at: null },
    { ...base, name: NAME.past, start_at: null, end_at: iso(-DAY) },
    { ...base, name: NAME.justExpired, start_at: iso(-DAY), end_at: iso(-1000) },
  ];
  const r = await admin.from('coupons').insert(rows);
  expect(r.error).toBeNull();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (tenantId) {
    const del = await admin.from('tenants').delete().eq('id', tenantId);
    expect(del.error).toBeNull();
    const left = await admin.from('coupons').select('id').eq('tenant_id', tenantId);
    expect(left.data ?? []).toHaveLength(0);
  }
});

describe('replyCoupons 有效期篩選（#1066，TEST Supabase）', () => {
  it('只列出生效中的券：兩段 .or() 以 AND 結合，ISO 時間被 PostgREST 正確解析', async () => {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const u = typeof input === 'string' ? input : input?.url ?? String(input);
      if (u.includes('/v2/bot/message/reply')) {
        sent.push(JSON.parse(init.body).messages[0].text);
        return new Response('{}', { status: 200 });
      }
      return realFetch(input, init);
    });
    const ctx = {
      admin,
      tenant: { id: tenantId, shop_code: 'c1066', name: 'itest', business_type: 'LOCAL_SHOP' },
      token: 'itest-token',
      replyToken: 'itest-reply',
      userId: 'Uitest1066',
      lineConfig: {},
    } as any;

    const ok = await replyCoupons(ctx);
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    const text = sent[0];
    expect(text).toContain(NAME.open);
    expect(text).toContain(NAME.window);
    expect(text).not.toContain(NAME.future);
    expect(text).not.toContain(NAME.past);
    expect(text).not.toContain(NAME.justExpired);
  });
});
