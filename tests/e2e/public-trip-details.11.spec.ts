import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { SHOP_A } from '../fixtures';
import {
  assertTestSupabaseTarget,
  projectRefFromSupabaseUrl,
  targetEvidenceFromEnvironment,
} from '../e2e-target-guard';

const dateAfter = (days: number): string => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

test('匿名旅客可從公開頁讀回真實方案與名額，重新整理後仍由後端保存資料呈現', async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env.TEST_SUPABASE_URL;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  expect(databaseUrl).toBeTruthy();
  expect(serviceRoleKey).toBeTruthy();
  assertTestSupabaseTarget(
    projectRefFromSupabaseUrl(databaseUrl),
    '公開行程詳情 E2E service-role admin client',
    targetEvidenceFromEnvironment(),
  );

  const admin = createClient(databaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tripId = randomUUID();
  const planId = randomUUID();
  const departureId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const slug = 'e2e-公開-' + suffix;
  const title = 'E2E 公開行程 ' + suffix;
  const planName = 'E2E 固定日期方案 ' + suffix;
  const departsOn = dateAfter(30);
  const write = async (label: string, action: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await action();
    if (error) throw new Error(label + ': ' + JSON.stringify(error));
  };

  try {
    await write('insert trip', () => admin.from('trips').insert({
      id: tripId,
      tenant_id: SHOP_A.id,
      slug,
      title,
      tagline: '',
      summary: '匿名公開行程 E2E',
      description: '以真實 TEST 行程資料驗證公開頁載入與重新整理。',
      location: '花蓮',
      meeting_point: '車站前集合',
      meeting_point_map_url: '',
      cover_image_url: '',
      gallery: [],
      includes: '',
      exclusions: [],
      notices: [],
      notes: '',
      refund_policy_type: 'STANDARD',
      midao_listing_note: '',
      status: 'PUBLISHED',
    }));
    await write('insert plan', () => admin.from('trip_plans').insert({
      id: planId,
      tenant_id: SHOP_A.id,
      trip_id: tripId,
      slug: slug + '-fixed',
      name: planName,
      description: '固定日期方案',
      price_per_person: 2400,
      price_type: 'PER_PERSON',
      min_party: 1,
      max_party: 8,
      sales_mode: 'FIXED_DEPARTURE',
      active: true,
    }));
    await write('insert departure', () => admin.from('trip_departures').insert({
      id: departureId,
      tenant_id: SHOP_A.id,
      trip_id: tripId,
      plan_id: planId,
      departs_on: departsOn,
      start_time: '09:30',
      capacity: 8,
      seats_booked: 2,
      status: 'OPEN',
    }));

    await page.goto('/s/' + SHOP_A.shopCode + '/trips/' + encodeURIComponent(slug));
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/剩 6 位/)).toBeVisible({ timeout: 15_000 });
    const bookingLink = page.getByRole('link', { name: '選擇日期並預約', exact: true });
    await expect(bookingLink).toHaveAttribute(
      'href',
      '/s/' + SHOP_A.shopCode + '/plans/' + planId + '/book',
    );

    // 中文 slug：LINE 舊式單數連結需 308 轉到單次編碼的 /trips/，且詳情頁可開。
    const legacy = await page.request.get(
      '/s/' + SHOP_A.shopCode + '/trip/' + encodeURIComponent(slug),
      { maxRedirects: 0 },
    );
    expect(legacy.status()).toBe(308);
    expect(legacy.headers()['location']).toContain(
      '/s/' + SHOP_A.shopCode + '/trips/' + encodeURIComponent(slug),
    );
    expect(legacy.headers()['location']).not.toContain('%25');

    await page.reload();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/剩 6 位/)).toBeVisible({ timeout: 15_000 });
  } finally {
    const cleanupFailures: string[] = [];
    for (const [label, action] of [
      ['trip_departures', () => admin.from('trip_departures').delete().eq('id', departureId)],
      ['trip_plans', () => admin.from('trip_plans').delete().eq('id', planId)],
      ['trips', () => admin.from('trips').delete().eq('id', tripId)],
    ] as const) {
      try {
        await write('cleanup ' + label, action);
      } catch (error) {
        cleanupFailures.push(String(error));
      }
    }
    const [departureReadback, planReadback, tripReadback] = await Promise.all([
      admin.from('trip_departures').select('id').eq('id', departureId),
      admin.from('trip_plans').select('id').eq('id', planId),
      admin.from('trips').select('id').eq('id', tripId),
    ]);
    for (const [label, result] of [
      ['trip_departures', departureReadback],
      ['trip_plans', planReadback],
      ['trips', tripReadback],
    ] as const) {
      if (result.error) cleanupFailures.push(label + ' cleanup readback failed: ' + JSON.stringify(result.error));
      else if ((result.data ?? []).length > 0) cleanupFailures.push(label + ' cleanup left fixture rows');
    }
    if (cleanupFailures.length) throw new Error('Issue #11 E2E cleanup failed: ' + cleanupFailures.join('; '));
  }
});
