import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safePublicMapLinkUrl } from '@/lib/public-url';
import { loadPublicTourRequestStatus } from '@/server/public-tour-request';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const TENANT = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const state: { trip: Record<string, unknown> | null; tripFilters: Array<[string, unknown]> } = {
  trip: null, tripFilters: [],
};

function fakeAdmin() {
  return {
    from: (table: string) => {
      if (table === 'tenants') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: TENANT }, error: null }) }) }) };
      }
      if (table === 'feature_subscriptions') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { active: true, expires_at: null }, error: null }) }) }) }),
        };
      }
      if (table === 'tour_orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ORDER_ID, tenant_id: TENANT, trip_id: TRIP_ID, contact: { phone: '0912345678' }, status: 'PENDING' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'trips') {
        // hydrateTourOrders 走 .eq().in()；#1070 的 meeting_point 查詢走 .eq().eq().maybeSingle()。
        const chain = {
          eq: (col: string, val: unknown) => { state.tripFilters.push([col, val]); return chain; },
          in: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: state.trip, error: null }),
        };
        return { select: () => chain };
      }
      return { select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) };
    },
  };
}

vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => fakeAdmin() }));

beforeEach(() => { state.trip = null; state.tripFilters = []; });

describe('issue #1070 — 狀態頁 loader 帶出集合地點', () => {
  it('有地點＋地圖連結：兩者都回傳', async () => {
    state.trip = { meeting_point: '  台北車站 M7 出口 ', meeting_point_map_url: 'https://maps.example.com/abc' };
    const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
    expect(order?.meetingPoint).toBe('台北車站 M7 出口');
    expect(order?.meetingPointMapUrl).toBe('https://maps.example.com/abc');
  });

  it('只有地點：不輸出地圖連結', async () => {
    state.trip = { meeting_point: '碼頭售票口', meeting_point_map_url: null };
    const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
    expect(order?.meetingPoint).toBe('碼頭售票口');
    expect(order?.meetingPointMapUrl).toBeUndefined();
  });

  it('無地點（空字串／null）：兩欄都不輸出', async () => {
    for (const trip of [
      { meeting_point: '', meeting_point_map_url: 'https://maps.example.com/x' },
      { meeting_point: null, meeting_point_map_url: null },
      null,
    ]) {
      state.trip = trip;
      const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
      expect(order?.meetingPoint).toBeUndefined();
      expect(order?.meetingPointMapUrl).toBeUndefined();
    }
  });

  it('非 http(s) 地圖連結被擋，地點文字仍保留', async () => {
    state.trip = { meeting_point: '集合點', meeting_point_map_url: 'javascript:alert(1)' };
    const order = await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
    expect(order?.meetingPoint).toBe('集合點');
    expect(order?.meetingPointMapUrl).toBeUndefined();
  });

  it('trips 查詢帶 tenant_id 與該訂單的 trip id 篩選', async () => {
    state.trip = { meeting_point: '集合點', meeting_point_map_url: null };
    await loadPublicTourRequestStatus('shop-a', ORDER_ID, '0912345678');
    expect(state.tripFilters).toContainEqual(['tenant_id', TENANT]);
    expect(state.tripFilters).toContainEqual(['id', TRIP_ID]);
  });
});

describe('issue #1070 — safePublicMapLinkUrl', () => {
  it('接受 http／https，拒絕其他協定、帶帳密與無效值', () => {
    expect(safePublicMapLinkUrl('https://maps.google.com/?q=1')).toContain('https://maps.google.com/');
    expect(safePublicMapLinkUrl('http://maps.example.com/a')).toBe('http://maps.example.com/a');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'https://u:p@x.com', 'not a url', '', null, 42]) {
      expect(safePublicMapLinkUrl(bad)).toBe('');
    }
  });
});

describe('issue #1070 — 狀態頁呈現（原始碼斷言）', () => {
  const page = read('src/app/s/[shopCode]/requests/[orderId]/page.tsx');
  it('地點有值才渲染；連結 target=_blank 且 rel=noopener noreferrer', () => {
    expect(page).toContain('order.meetingPoint ? (');
    expect(page).toContain('order.meetingPointMapUrl ? (');
    expect(page).toContain('target="_blank"');
    expect(page).toContain('rel="noopener noreferrer"');
  });
  it('文案走 i18n，不硬編中文', () => {
    expect(page).toContain('t.status.fields.meetingPoint');
    expect(page).toContain('t.status.openMap');
    const i18n = read('src/i18n/zh-TW/pages/public-tour-request.ts');
    expect(i18n).toContain("meetingPoint: '集合地點'");
    expect(i18n).toContain("openMap: '開啟地圖'");
  });
});
