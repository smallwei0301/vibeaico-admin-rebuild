import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const loader = readFileSync(resolve(ROOT, 'src/server/public-shop.ts'), 'utf8');
const shopPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/page.tsx'), 'utf8');
const detailPage = readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/trips/[slug]/page.tsx'), 'utf8');
const detailClient = readFileSync(resolve(ROOT, 'src/components/public/PublicTripDetailsClient.tsx'), 'utf8');
const route = readFileSync(
  resolve(ROOT, 'src/app/api/public/shops/[shopCode]/trips/[slug]/route.ts'), 'utf8',
);

describe('#11 公開行程詳情', () => {
  it('從店家頁可到 slug 詳情頁，並由安全頁殼與公開 API 分工載入資料', () => {
    expect(shopPage).toContain('`/s/${shopCode}/trips/${encodeURIComponent(trip.slug)}`');
    expect(detailPage).toContain('<PublicTripDetailsClient');
    expect(detailPage).not.toContain('loadPublicTripDetails');
    expect(detailClient).toContain("fetch(path, { cache: 'no-store' })");
    expect(detailClient).toContain('/api/public/shops/');
    expect(route).toContain('loadPublicTripDetails(shopCode, slug)');
    expect(route).not.toMatch(/createAdminSupabase|\.from\(['"]trips['"]\)/);
  });

  it('詳情查詢只讀安全欄位，且同時限制 tenant、trip id、slug 與 PUBLISHED 狀態', () => {
    const columns = loader.match(/const PUBLIC_TRIP_DETAILS_COLUMNS = \[([\s\S]*?)\]\s*as const/);
    const detailQuery = loader.slice(loader.indexOf('async function loadPublicTripDetailsUncached'));
    expect(columns, '找不到公開詳情 select 白名單').toBeTruthy();
    expect(columns?.[1]).toContain('cover_image_url');
    expect(detailQuery).toContain(".select(PUBLIC_TRIP_DETAILS_COLUMNS.join(', '))");
    expect(detailQuery).toContain(".eq('tenant_id', shopData.tenantId)");
    expect(detailQuery).toContain(".eq('id', knownTrip.id)");
    expect(detailQuery).toContain(".eq('slug', slug)");
    expect(detailQuery).toContain(".eq('status', 'PUBLISHED')");
    expect(columns?.[1]).not.toMatch(/midao_listing_note|midao_listing|tenant_settings|customers|staff|tour_orders/);
    expect(detailQuery).toContain(".select('id, departs_on, start_time, capacity, seats_booked')");
    expect(detailQuery).toContain(".eq('trip_id', knownTrip.id)");
    expect(detailQuery).toContain(".eq('plan_id', plan.id)");
    expect(detailQuery).toContain(".eq('status', 'OPEN')");
    expect(loader).toContain(".eq('plan_id', plan.id)");
    expect(detailQuery).toContain('.range(offset, offset + pageSize - 1)');
    expect(detailQuery).toContain('departuresMayBeTruncated');
    expect(detailClient).toContain('t.departures.truncated');
  });

  it('公開 API 有節流、CORS 與不快取設定，並以 404 隱藏未公開行程', () => {
    expect(route).toContain("from '@/server/rate-limit'");
    expect(route).toContain('checkRateLimit(');
    expect(route).toContain("from '@/server/public-cors'");
    expect(route).toContain('publicCorsHeaders(');
    expect(route).toContain('export function OPTIONS');
    expect(route).toContain("fail(404, '找不到這個行程', ERR.NOT_FOUND)");
    expect(route).toContain('fail(500, \'系統發生錯誤，請稍後再試\', ERR.INTERNAL)');
    expect(route).toContain('withCors(');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(detailPage).toContain("export const dynamic = 'force-dynamic'");
  });

  it('詳情頁沿用真實 REQUEST／FIXED 入口，INSTANT 只顯示聯絡說明', () => {
    expect(detailClient).toContain("href={`/s/${shopCode}/plans/${plan.id}/request`}");
    expect(detailClient).toContain("href={`/s/${shopCode}/plans/${plan.id}/book`}");
    expect(detailClient).toContain("plan.salesMode === 'INSTANT'");
    expect(detailClient).not.toMatch(/href=\{`\/s\/\$\{shopCode\}\/plans\/\$\{plan\.id\}\/instant/);
    expect(detailClient).toContain('plan.departures');
    expect(detailClient).toContain('trip.meetingPointMapUrl');
    expect(detailClient).toContain('trip.inclusions');
    expect(detailClient).toContain('trip.exclusions');
    expect(detailClient).toContain('trip.notices');
  });

  it('詳情 select 欄位只含 canonical migrations 的 trips 欄位，不含 region／category', () => {
    const body = loader.match(/const PUBLIC_TRIP_DETAILS_COLUMNS = \[([\s\S]*?)\]\s*as const/)?.[1] ?? '';
    const cols = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).not.toContain('region');
    expect(cols).not.toContain('category');

    const dir = resolve(ROOT, 'supabase/migrations');
    const defined = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      const create = sql.match(/create table if not exists public\.trips \(([\s\S]*?)\n\);/);
      if (create) {
        for (const line of create[1].split('\n')) {
          const m = line.match(/^\s{2}([a-z_]+)\s+\S/);
          if (m) defined.add(m[1]);
        }
      }
      for (const alter of sql.matchAll(/alter table (?:if exists )?public\.trips\b([\s\S]*?);/gi)) {
        for (const m of alter[1].matchAll(/add column if not exists ([a-z_]+)/gi)) defined.add(m[1]);
      }
    }
    expect([...defined]).toContain('location');
    expect(cols.filter((c) => !defined.has(c)), '公開詳情不得 select 非 canonical 欄位').toEqual([]);
  });
});
