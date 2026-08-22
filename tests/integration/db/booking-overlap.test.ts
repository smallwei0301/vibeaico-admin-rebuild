/**
 * 預約重疊排除約束 — 12 分冊 §4「Phase 0–1」矩陣：
 *   「同員工重疊插入被 23P01 擋；不同員工/CANCELLED 不擋」
 * 對應 02 分冊本冊驗收：「bookings 插入兩筆同員工重疊時段，第二筆被
 * x_bookings_overlap 擋下」（constraint 定義見 0004 migration）。
 *
 * 約束原文（0004）：
 *   exclude using gist (tenant_id with =, staff_id with =,
 *                       tstzrange(start_at, end_at) with &&)
 *   where (status in ('PENDING','CONFIRMED') and staff_id is not null)
 *
 * 用 service-role client 插入（繞過 RLS，這裡測的是資料庫約束不是 RLS —— RLS
 * 另有 rls.test.ts）。時間窗全部用寫死的遠未來時刻，各案例日期錯開，避免
 * 案例間與 seed 資料互相干擾；booking_no 用 BOVL 前綴，beforeAll 先清一次。
 *
 * ⚠️ TDD 紅燈說明：Phase 1 migrations 套用到 TEST 專案前，插入會因表不存在而
 * 失敗 → 紅燈。migration + seed 之後應全綠。不得為轉綠放寬斷言（12 §2.4）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;
const serviceKey = () => process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;

/** 產生一筆合法 booking 的共同欄位（customer/service 用 seed 的固定 id） */
function baseBooking(no: string, startIso: string, endIso: string) {
  return {
    tenant_id: SHOP_A.id,
    booking_no: no,
    customer_id: SHOP_A.customerA1,
    service_id: SHOP_A.serviceA1,
    start_at: startIso,
    end_at: endIso,
    duration_minutes: 60,
    price: 800,
    final_price: 800,
    source: 'MANUAL',
  };
}

describe('bookings 重疊排除約束 x_bookings_overlap（02 分冊 0004）', () => {
  let admin: SupabaseClient;

  beforeAll(async () => {
    expect(url()).toBeTruthy();
    expect(serviceKey()).toBeTruthy();
    admin = createClient(url(), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // 冪等：清掉先前跑到一半留下的 BOVL 測試列（global-setup 的 reset-db 每輪
    // 也會清，但單獨重跑本檔時要能自保）。
    const { error } = await admin.from('bookings').delete().like('booking_no', 'BOVL%');
    expect(error).toBeNull();
  });

  afterAll(async () => {
    await admin.from('bookings').delete().like('booking_no', 'BOVL%');
  });

  it('a) 同員工、時段重疊、皆計入約束（CONFIRMED+PENDING）→ 第二筆 23P01', async () => {
    const first = await admin.from('bookings').insert({
      ...baseBooking('BOVL-A1', '2027-03-01T02:00:00Z', '2027-03-01T03:00:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CONFIRMED',
    });
    expect(first.error).toBeNull();

    const second = await admin.from('bookings').insert({
      ...baseBooking('BOVL-A2', '2027-03-01T02:30:00Z', '2027-03-01T03:30:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'PENDING',
    });
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23P01'); // exclusion_violation
  });

  it('b) 同員工重疊、但既有那筆是 CANCELLED → 不擋（約束 where 只計 PENDING/CONFIRMED）', async () => {
    const cancelled = await admin.from('bookings').insert({
      ...baseBooking('BOVL-B1', '2027-03-02T02:00:00Z', '2027-03-02T03:00:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CANCELLED',
    });
    expect(cancelled.error).toBeNull();

    const overlapping = await admin.from('bookings').insert({
      ...baseBooking('BOVL-B2', '2027-03-02T02:30:00Z', '2027-03-02T03:30:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CONFIRMED',
    });
    expect(overlapping.error).toBeNull();
  });

  it('c) 時段重疊但不同員工 → 不擋', async () => {
    const s1 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-C1', '2027-03-03T02:00:00Z', '2027-03-03T03:00:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CONFIRMED',
    });
    expect(s1.error).toBeNull();

    const s2 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-C2', '2027-03-03T02:30:00Z', '2027-03-03T03:30:00Z'),
      staff_id: SHOP_A.staffA2,
      status: 'CONFIRMED',
    });
    expect(s2.error).toBeNull();
  });

  it('d) 未指定員工（staff_id null）兩筆重疊 → 不擋（約束 where 排除 null）', async () => {
    const n1 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-D1', '2027-03-04T02:00:00Z', '2027-03-04T03:00:00Z'),
      staff_id: null,
      status: 'CONFIRMED',
    });
    expect(n1.error).toBeNull();

    const n2 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-D2', '2027-03-04T02:30:00Z', '2027-03-04T03:30:00Z'),
      staff_id: null,
      status: 'PENDING',
    });
    expect(n2.error).toBeNull();
  });

  it('e) 緊鄰不重疊（[2,3) 與 [3,4)）→ 不擋（tstzrange 半開區間）', async () => {
    const t1 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-E1', '2027-03-05T02:00:00Z', '2027-03-05T03:00:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CONFIRMED',
    });
    expect(t1.error).toBeNull();

    const t2 = await admin.from('bookings').insert({
      ...baseBooking('BOVL-E2', '2027-03-05T03:00:00Z', '2027-03-05T04:00:00Z'),
      staff_id: SHOP_A.staffA1,
      status: 'CONFIRMED',
    });
    expect(t2.error).toBeNull();
  });
});
