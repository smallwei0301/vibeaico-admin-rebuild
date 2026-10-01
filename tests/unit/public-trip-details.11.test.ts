import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const loader = readFileSync(resolve(ROOT, 'src/server/public-shop.ts'), 'utf8');
const shopPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/page.tsx'), 'utf8');
const detailPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/trips/[slug]/page.tsx'), 'utf8');
const route = readFileSync(
  resolve(ROOT, 'src/app/api/public/shops/[shopCode]/trips/[slug]/route.ts'), 'utf8',
);

describe('#11 公開行程詳情', () => {
  it('從店家頁可到 slug 詳情頁，並以同一個 tenant-scoped loader 供頁面與 API 使用', () => {
    expect(shopPage).toContain('`/s/${shopCode}/trips/${encodeURIComponent(trip.slug)}`');
    expect(detailPage).toContain('loadPublicTripDetails(shopCode, slug)');
    expect(route).toContain('loadPublicTripDetails(shopCode, slug)');
    expect(route).not.toMatch(/createAdminSupabase|\.from\(['"]trips['"]\)/);
  });

  it('詳情查詢只讀安全欄位，且同時限制 tenant、trip id、slug 與 PUBLISHED 狀態', () => {
    const columns = loader.match(/const PUBLIC_TRIP_DETAILS_COLUMNS = \[([\s\S]*?)\] as const/);
    expect(columns, '找不到公開詳情 select 白名單').toBeTruthy();
    expect(loader).toContain('.select(PUBLIC_TRIP_DETAILS_COLUMNS.join(\', \'))');
    expect(loader).toContain(".eq('tenant_id', shopData.tenantId)");
    expect(loader).toContain(".eq('id', knownTrip.id)");
    expect(loader).toContain(".eq('slug', slug)");
    expect(loader).toContain(".eq('status', 'PUBLISHED')");
    expect(columns?.[1]).not.toMatch(/midao_listing_note|midao_listing|tenant_settings|customers|staff|tour_orders/);
    expect(loader).toContain(".select('id, plan_id, departs_on, start_time, capacity, seats_booked')");
    expect(loader).toContain(".eq('trip_id', knownTrip.id)");
    expect(loader).toContain(".in('plan_id', planIds)");
    expect(loader).toContain(".eq('status', 'OPEN')");
  });

  it('公開 API 有節流、CORS 與不快取設定，並以 404 隱藏未公開行程', () => {
    expect(route).toContain("from '@/server/rate-limit'");
    expect(route).toContain('checkRateLimit(');
    expect(route).toContain("from '@/server/public-cors'");
    expect(route).toContain('publicCorsHeaders(');
    expect(route).toContain('export function OPTIONS');
    expect(route).toContain("fail(404, '找不到這個行程', ERR.NOT_FOUND)");
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(detailPage).toContain("export const dynamic = 'force-dynamic'");
  });

  it('詳情頁沿用真實 REQUEST／FIXED 入口，INSTANT 只顯示聯絡說明', () => {
    expect(detailPage).toContain("href={`/s/${shopCode}/plans/${plan.id}/request`}");
    expect(detailPage).toContain("href={`/s/${shopCode}/plans/${plan.id}/book`}");
    expect(detailPage).toContain("plan.salesMode === 'INSTANT'");
    expect(detailPage).not.toMatch(/href=\{`\/s\/\$\{shopCode\}\/plans\/\$\{plan\.id\}\/instant/);
    expect(detailPage).toContain('plan.departures');
    expect(detailPage).toContain('trip.meetingPointMapUrl');
    expect(detailPage).toContain('trip.inclusions');
    expect(detailPage).toContain('trip.exclusions');
    expect(detailPage).toContain('trip.notices');
  });
});
