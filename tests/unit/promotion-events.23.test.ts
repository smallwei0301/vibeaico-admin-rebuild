/**
 * tests/unit/promotion-events.23.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/promotion-events.ts`（Issue #23）：
 *   1. source 分類（?src=qr/line/無參數 → QR/LINE/DIRECT）。
 *   2. `recordPromotionPageView` 是 best-effort ——DB insert 失敗、或整個函式體
 *      任何一步丟例外，都不能讓例外冒出這個函式（公開頁 render 不能被打掛）。
 *   3. `cleanupExpiredPromotionEvents` 只刪超過 180 天的舊列（bounded delete），
 *      並把 `if_version` 風格的 cutoff 邊界算對。
 *
 * 用這個檔案既有的 `vi.mock('@/server/tenant', …)` 同款 fake-Supabase 手法
 * （見 tests/unit/line-disconnect-route.47.test.ts），對 `@/server/supabase`
 * 與 `next/headers` 做假物件，不碰真 DB。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null as { message: string } | null }));
const deleteEqChain = {
  lt: vi.fn(() => ({
    select: vi.fn(async () => ({
      data: [] as { id: string }[] | null,
      error: null as { message: string } | null,
    })),
  })),
};

const fakeAdminSupabase = {
  from: vi.fn((table: string) => {
    if (table !== 'page_view_events') throw new Error(`unexpected table in test: ${table}`);
    return {
      insert: insertMock,
      delete: () => deleteEqChain,
    };
  }),
};

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => fakeAdminSupabase,
}));

let fakeHeaders = new Map<string, string>();
const headersMock = vi.fn(async () => ({
  get: (key: string) => fakeHeaders.get(key.toLowerCase()) ?? null,
}));
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}));

import {
  classifySource,
  cleanupExpiredPromotionEvents,
  recordPromotionPageView,
  PROMOTION_EVENT_RETENTION_DAYS,
} from '@/server/promotion-events';

describe('classifySource（issue #23 最小分類）', () => {
  it.each([
    ['qr', 'QR'],
    ['QR', 'QR'],
    ['line', 'LINE'],
    ['LINE', 'LINE'],
    [undefined, 'DIRECT'],
    [null, 'DIRECT'],
    ['', 'DIRECT'],
    ['facebook', 'DIRECT'], // 未驗證的來源一律落 DIRECT，不自行猜測新 enum
  ])('%s → %s', (raw, expected) => {
    expect(classifySource(raw as string | undefined)).toBe(expected);
  });
});

describe('recordPromotionPageView（issue #23：best-effort，失敗不得冒出例外）', () => {
  beforeEach(() => {
    insertMock.mockClear();
    fakeHeaders = new Map([
      ['x-forwarded-for', '203.0.113.7, 70.41.3.18'],
      ['user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
    ]);
  });

  it('正常路徑：寫入一列，tenant_id/path/source/visitor_hash/user_agent_class 齊全，且沒有任何 ip 欄位', async () => {
    await recordPromotionPageView({ tenantId: 'tenant-a', path: '/s/shop-a', rawSrc: 'line' });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0];
    expect(payload.tenant_id).toBe('tenant-a');
    expect(payload.path).toBe('/s/shop-a');
    expect(payload.source).toBe('LINE');
    expect(typeof payload.visitor_hash).toBe('string');
    expect((payload.visitor_hash as string).length).toBeGreaterThan(0);
    expect(payload.user_agent_class).toBe('MOBILE');
    // 不得出現任何看起來像 IP 欄位的 key。
    expect(Object.keys(payload).some((k) => k.toLowerCase().includes('ip'))).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('203.0.113.7');
  });

  it('x-forwarded-for 取第一段當客戶端 IP（其餘為 proxy 鏈）', async () => {
    await recordPromotionPageView({ tenantId: 'tenant-a', path: '/s/shop-a', rawSrc: null });
    // 用不同 IP 重放一次，兩次 hash 應該不同，證明它真的讀到了 x-forwarded-for
    // 而不是永遠退回 'unknown'。
    const firstHash = insertMock.mock.calls[0][0].visitor_hash;
    fakeHeaders.set('x-forwarded-for', '198.51.100.9');
    await recordPromotionPageView({ tenantId: 'tenant-a', path: '/s/shop-a', rawSrc: null });
    const secondHash = insertMock.mock.calls[1][0].visitor_hash;
    expect(firstHash).not.toBe(secondHash);
  });

  it('DB insert 回傳 error 時吞掉，不丟出例外（公開頁不能因此壞掉）', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(
      recordPromotionPageView({ tenantId: 'tenant-a', path: '/s/shop-a', rawSrc: null }),
    ).resolves.toBeUndefined();
  });

  it('headers() 本身丟例外時也吞掉，不影響呼叫端', async () => {
    headersMock.mockRejectedValueOnce(new Error('headers unavailable'));
    await expect(
      recordPromotionPageView({ tenantId: 'tenant-a', path: '/s/shop-a', rawSrc: null }),
    ).resolves.toBeUndefined();
  });
});

describe('cleanupExpiredPromotionEvents（issue #23：180 天 bounded retention）', () => {
  it('用 PROMOTION_EVENT_RETENTION_DAYS 算出正確的 cutoff，且只刪過期列', async () => {
    const now = new Date('2026-09-15T00:00:00Z');
    const result = await cleanupExpiredPromotionEvents(now);
    const expectedCutoff = new Date(
      now.getTime() - PROMOTION_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(result.cutoffIso).toBe(expectedCutoff);
    expect(deleteEqChain.lt).toHaveBeenCalledWith('created_at', expectedCutoff);
  });

  it('刪除失敗時把錯誤丟出（cleanup 本身失敗要看得見，由呼叫端的 cron route 決定怎麼回應）', async () => {
    deleteEqChain.lt.mockReturnValueOnce({
      select: vi.fn(async () => ({ data: null, error: { message: 'delete failed' } })),
    });
    await expect(cleanupExpiredPromotionEvents(new Date())).rejects.toBeTruthy();
  });
});
