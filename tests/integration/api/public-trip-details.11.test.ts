import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = `I11-${randomUUID().slice(0, 8)}`;
const PUBLISHED_TRIP = randomUUID();
const DRAFT_TRIP = randomUUID();
const OTHER_TENANT_TRIP = randomUUID();
const REQUEST_PLAN = randomUUID();
const FIXED_PLAN = randomUUID();
const REQUEST_DEPARTURE = randomUUID();
const FIXED_DEPARTURE = randomUUID();
const SOLD_OUT_DEPARTURES = Array.from({ length: 125 }, () => randomUUID());
const EXTRA_AVAILABLE_DEPARTURES = Array.from({ length: 6 }, () => randomUUID());
const SLUG = `issue-11-${randomUUID().slice(0, 8)}`;
const TITLE = `${TAG} 已發布公開行程`;
const OTHER_TENANT_TITLE = `${TAG} 另一店的同 slug 行程`;
const SECRET_REVIEW_NOTE = `${TAG}-internal-review-note-must-not-leak`;
const UNSAFE_URL = `${TAG}-javascript-url-must-not-leak`;
function dateAfter(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const FUTURE = dateAfter(300);
const FUTURE_SECOND = dateAfter(301);

let admin: SupabaseClient;

function mustWrite(label: string, result: { error: unknown }): void {
  if (result.error) throw new Error(`前置資料寫入失敗（${label}）：${JSON.stringify(result.error)}`);
}

async function request(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.text() };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  mustWrite('trips', await admin.from('trips').insert([
    {
      id: PUBLISHED_TRIP,
      tenant_id: SHOP_A.id,
      slug: SLUG,
      title: TITLE,
      tagline: `${TAG} 行程標語`,
      summary: `${TAG} 行程摘要`,
      description: `${TAG} 行程詳細介紹`,
      location: '花蓮',
      meeting_point: `${TAG} 集合地點`,
      meeting_point_map_url: 'https://maps.google.com/?q=Hualien',
      cover_image_url: `javascript:${UNSAFE_URL}`,
      gallery: [`javascript:${UNSAFE_URL}`, 'https://example.com/public-trip-image.webp'],
      includes: `${TAG} 費用包含一\n${TAG} 費用包含二`,
      exclusions: [`${TAG} 費用不含`],
      notices: [`${TAG} 行前須知`],
      notes: `${TAG} 安全提醒`,
      refund_policy_type: 'STANDARD',
      midao_listing_note: SECRET_REVIEW_NOTE,
      status: 'PUBLISHED',
    },
    {
      id: DRAFT_TRIP,
      tenant_id: SHOP_A.id,
      slug: `${SLUG}-draft`,
      title: `${TAG} 草稿不可公開`,
      tagline: '', summary: '', description: '', location: '', meeting_point: '',
      meeting_point_map_url: '', cover_image_url: '', gallery: [], includes: '',
      exclusions: [], notices: [], notes: '', refund_policy_type: 'STANDARD',
      midao_listing_note: '', status: 'DRAFT',
    },
    {
      id: OTHER_TENANT_TRIP,
      tenant_id: SHOP_B.id,
      slug: SLUG,
      title: OTHER_TENANT_TITLE,
      tagline: '', summary: '', description: '', location: '', meeting_point: '',
      meeting_point_map_url: '', cover_image_url: '', gallery: [], includes: '',
      exclusions: [], notices: [], notes: '', refund_policy_type: 'STANDARD',
      midao_listing_note: '', status: 'PUBLISHED',
    },
  ]));

  mustWrite('trip_plans', await admin.from('trip_plans').insert([
    {
      id: REQUEST_PLAN, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      slug: `${SLUG}-request`,
      name: `${TAG} REQUEST 方案`, description: `${TAG} 方案內容`,
      price_per_person: 1800, min_party: 2, max_party: 8,
      sales_mode: 'REQUEST', active: true,
    },
    {
      id: FIXED_PLAN, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      slug: `${SLUG}-fixed`,
      name: `${TAG} FIXED 方案`, description: `${TAG} 固定團次方案內容`,
      price_per_person: 2200, min_party: 1, max_party: 6,
      sales_mode: 'FIXED_DEPARTURE', active: true,
    },
  ]));

  mustWrite('trip_departures', await admin.from('trip_departures').insert([
    {
      id: REQUEST_DEPARTURE, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      plan_id: REQUEST_PLAN, departs_on: FUTURE, start_time: '09:00',
      capacity: 8, seats_booked: 3, status: 'OPEN',
    },
    {
      id: FIXED_DEPARTURE, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      plan_id: FIXED_PLAN, departs_on: FUTURE_SECOND, start_time: '10:00',
      capacity: 8, seats_booked: 2, status: 'OPEN',
    },
    ...SOLD_OUT_DEPARTURES.map((id, index) => ({
      id, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      plan_id: REQUEST_PLAN, departs_on: dateAfter(index + 1), start_time: '08:00',
      capacity: 1, seats_booked: 1, status: 'OPEN',
    })),
    ...EXTRA_AVAILABLE_DEPARTURES.map((id, index) => ({
      id, tenant_id: SHOP_A.id, trip_id: PUBLISHED_TRIP,
      plan_id: REQUEST_PLAN, departs_on: dateAfter(301 + index), start_time: '09:00',
      capacity: 8, seats_booked: 0, status: 'OPEN',
    })),
  ]));

  const readback = await admin.from('trips').select('id').in('id', [
    PUBLISHED_TRIP, DRAFT_TRIP, OTHER_TENANT_TRIP,
  ]);
  mustWrite('trips 讀回核實', readback);
  expect((readback.data ?? []).length, '三筆行程前置資料未完整寫入').toBe(3);

  const seededPlans = await admin.from('trip_plans').select('id').in('id', [REQUEST_PLAN, FIXED_PLAN]);
  mustWrite('方案讀回核實', seededPlans);
  expect((seededPlans.data ?? []).length, '兩筆方案前置資料未完整寫入').toBe(2);
  const seededDepartures = await admin.from('trip_departures').select('id')
    .in('id', [
      REQUEST_DEPARTURE, FIXED_DEPARTURE, ...SOLD_OUT_DEPARTURES, ...EXTRA_AVAILABLE_DEPARTURES,
    ]);
  mustWrite('團次讀回核實', seededDepartures);
  expect((seededDepartures.data ?? []).length, '團次前置資料未完整寫入')
    .toBe(2 + SOLD_OUT_DEPARTURES.length + EXTRA_AVAILABLE_DEPARTURES.length);
});

afterAll(async () => {
  if (!admin) return;
  const cleanupFailures: string[] = [];
  const allDepartureIds = [
    REQUEST_DEPARTURE, FIXED_DEPARTURE, ...SOLD_OUT_DEPARTURES, ...EXTRA_AVAILABLE_DEPARTURES,
  ];
  const runCleanup = async (label: string, action: () => PromiseLike<{ error: unknown }>) => {
    try {
      const { error } = await action();
      if (error) cleanupFailures.push(`${label} delete failed: ${JSON.stringify(error)}`);
    } catch (error) {
      cleanupFailures.push(`${label} delete threw: ${String(error)}`);
    }
  };

  await runCleanup('trip_departures', () => admin.from('trip_departures').delete().in('id', allDepartureIds));
  await runCleanup('trip_plans', () => admin.from('trip_plans').delete().in('id', [REQUEST_PLAN, FIXED_PLAN]));
  await runCleanup('trips', () => admin.from('trips').delete().in('id', [PUBLISHED_TRIP, DRAFT_TRIP, OTHER_TENANT_TRIP]));

  const [departureReadback, planReadback, tripReadback] = await Promise.all([
    admin.from('trip_departures').select('id').in('id', allDepartureIds),
    admin.from('trip_plans').select('id').in('id', [REQUEST_PLAN, FIXED_PLAN]),
    admin.from('trips').select('id').in('id', [PUBLISHED_TRIP, DRAFT_TRIP, OTHER_TENANT_TRIP]),
  ]);
  for (const [label, result] of [
    ['trip_departures', departureReadback], ['trip_plans', planReadback], ['trips', tripReadback],
  ] as const) {
    if (result.error) cleanupFailures.push(`${label} cleanup readback failed: ${JSON.stringify(result.error)}`);
    else if ((result.data ?? []).length > 0) {
      cleanupFailures.push(`${label} cleanup left ${(result.data ?? []).length} fixture rows`);
    }
  }
  if (cleanupFailures.length) throw new Error(`Issue #11 fixture cleanup failed:\n${cleanupFailures.join('\n')}`);
});

describe('#11 公開行程詳情頁與 API', () => {
  it('略過較早售罄團次後，匿名旅客仍可看到每個方案較晚的可用團次', async () => {
    const { status, body } = await request(`/s/${SHOP_A.shopCode}/trips/${encodeURIComponent(SLUG)}`);
    expect(status).toBe(200);
    expect(body).toContain(TITLE);
    expect(body).toContain(`${TAG} 行程詳細介紹`);
    expect(body).toContain(`${TAG} 費用包含一`);
    expect(body).toContain(`${TAG} 費用不含`);
    expect(body).toContain(`${TAG} 行前須知`);
    expect(body).toContain(`${TAG} 安全提醒`);
    expect(body).toContain(`${TAG} REQUEST 方案`);
    expect(body).toContain(`${TAG} FIXED 方案`);
    expect(body).toContain('提出預約申請');
    expect(body).toContain('選擇日期並預約');
    expect(body).toContain('剩 5 位');
    expect(body).toContain('剩 6 位');
    expect(body).toContain('本頁每個方案最多列出 6 筆近期團次');
    expect(body).not.toContain(SECRET_REVIEW_NOTE);
    expect(body).not.toContain(UNSAFE_URL);
  });

  it('公開 API 回報六筆顯示上限，並保留最早的有名額團次', async () => {
    const { status, body } = await request(
      `/api/public/shops/${SHOP_A.shopCode}/trips/${encodeURIComponent(SLUG)}`,
    );
    expect(status).toBe(200);
    const response = JSON.parse(body) as {
      success: boolean;
      data: {
        trip: {
          plans: Array<{
            name: string;
            departures: Array<{ id: string; seatsLeft: number }>;
            departuresMayBeTruncated: boolean;
          }>;
        };
      };
    };
    const requestPlan = response.data.trip.plans.find((plan) => plan.name === `${TAG} REQUEST 方案`);
    expect(requestPlan?.departures).toHaveLength(6);
    expect(requestPlan?.departures[0]).toEqual({
      id: REQUEST_DEPARTURE,
      departsOn: FUTURE,
      startTime: '09:00',
      seatsLeft: 5,
    });
    expect(requestPlan?.departuresMayBeTruncated).toBe(true);
  });

  it('公開 JSON 只回 safe details，不回內部 tenant id 或審核備註，圖片 URL 僅保留 HTTPS', async () => {
    const { status, body } = await request(
      `/api/public/shops/${SHOP_A.shopCode}/trips/${encodeURIComponent(SLUG)}`,
    );
    expect(status).toBe(200);
    const response = JSON.parse(body) as {
      success: boolean;
      data: {
        trip: {
          title: string;
          coverImageUrl: string;
          galleryUrls: string[];
          plans: Array<{ name: string; departures: Array<{ seatsLeft: number }> }>;
        };
      };
    };
    expect(response.success).toBe(true);
    expect(response.data.trip.title).toBe(TITLE);
    expect(body).toContain('https://maps.google.com/');
    expect(body).toContain('https://example.com/public-trip-image.webp');
    expect(body).not.toContain('tenantId');
    expect(body).not.toContain(SECRET_REVIEW_NOTE);
    expect(body).not.toContain(UNSAFE_URL);
    expect(response.data.trip.coverImageUrl).toBe('');
    expect(response.data.trip.galleryUrls).toEqual(['https://example.com/public-trip-image.webp']);
    const requestPlan = response.data.trip.plans.find((plan) => plan.name === `${TAG} REQUEST 方案`);
    const fixedPlan = response.data.trip.plans.find((plan) => plan.name === `${TAG} FIXED 方案`);
    expect(requestPlan?.departures.map((departure) => departure.seatsLeft)).toEqual([5, 8, 8, 8, 8, 8]);
    expect(fixedPlan?.departures.map((departure) => departure.seatsLeft)).toEqual([6]);
  });

  it('每家店可有自己的同 slug 行程，且公開讀取依 shopCode 隔離', async () => {
    const draft = await request(`/s/${SHOP_A.shopCode}/trips/${encodeURIComponent(`${SLUG}-draft`)}`);
    const otherTenant = await request(`/s/${SHOP_B.shopCode}/trips/${encodeURIComponent(SLUG)}`);
    const otherTenantApi = await request(
      `/api/public/shops/${SHOP_B.shopCode}/trips/${encodeURIComponent(SLUG)}`,
    );
    const missing = await request(`/api/public/shops/${SHOP_A.shopCode}/trips/no-such-trip`);
    expect(draft.status).toBe(404);
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body).toContain(OTHER_TENANT_TITLE);
    expect(otherTenant.body).not.toContain(TITLE);
    expect(otherTenantApi.status).toBe(200);
    expect(JSON.parse(otherTenantApi.body).data.trip.title).toBe(OTHER_TENANT_TITLE);
    expect(otherTenantApi.body).not.toContain(TITLE);
    expect(missing.status).toBe(404);
  });
});
