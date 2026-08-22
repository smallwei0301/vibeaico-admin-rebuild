/**
 * RLS 隔離驗證 — 12 分冊 §4「Phase 0–1」矩陣：
 *   「anon 未登入查 customers 回空；A 帳號查不到 B 店資料（逐張核心表）」
 * 對應 02 分冊本冊驗收：「用 anon key + 未登入呼叫 select * from customers 回空」。
 *
 * 這個檔案不打 /api（Phase 2 才有 API），直接用 supabase-js 對 TEST 資料庫查，
 * 驗的是 Postgres RLS 本身（0003/0006 migration 的 policy）。
 *
 * ⚠️ TDD 紅燈說明：在 Phase 1 migrations 尚未套用到 TEST 專案之前，這些查詢會
 * 回 PGRST205（表不存在）而非空陣列 → 測試紅燈。這是誠實的「先寫測試」狀態；
 * migration 套用 + seed 跑過之後應全綠。不得為了提早轉綠而放寬斷言（12 §2.4）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;
const anonKey = () => process.env.TEST_SUPABASE_ANON_KEY!;

/** 12 分冊說「逐張核心表」——挑有 tenant_id 且業務敏感度最高的幾張 */
const CORE_TABLES = ['customers', 'bookings', 'services', 'staff', 'coupons'] as const;

describe('RLS：anon 未登入（02 分冊 0006 樣板 policy）', () => {
  let anon: SupabaseClient;

  beforeAll(() => {
    expect(url()).toBeTruthy();
    expect(anonKey()).toBeTruthy();
    anon = createClient(url(), anonKey(), { auth: { persistSession: false } });
  });

  for (const table of CORE_TABLES) {
    it(`未登入 select * from ${table} → 回空陣列（不是錯誤，是 RLS 濾成 0 列）`, async () => {
      const { data, error } = await anon.from(table).select('*');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});

describe('RLS：跨租戶隔離（A 帳號查不到 B 店資料）', () => {
  let asOwnerA: SupabaseClient;

  beforeAll(async () => {
    asOwnerA = createClient(url(), anonKey(), { auth: { persistSession: false } });
    const { error } = await asOwnerA.auth.signInWithPassword({
      email: SHOP_A.owner.email,
      password: SHOP_A.owner.password,
    });
    expect(error).toBeNull(); // seed 建立的帳號必須能登入
  });

  it('A owner 以 B 店 tenant_id 過濾查 customers → 空陣列', async () => {
    const { data, error } = await asOwnerA
      .from('customers')
      .select('*')
      .eq('tenant_id', SHOP_B.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A owner 不帶過濾查 customers → 只看得到 A 店的列，且絕無 B 店種子顧客', async () => {
    const { data, error } = await asOwnerA.from('customers').select('id, tenant_id');
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // seed 給 A 店 3 位顧客 —— 至少要查得到自己店的資料（證明不是「整張表都被擋」的假陰性）
    expect(data!.length).toBeGreaterThanOrEqual(3);
    for (const row of data!) {
      expect(row.tenant_id).toBe(SHOP_A.id);
    }
    expect(data!.some((r) => r.id === SHOP_B.customerB1)).toBe(false);
  });

  it('A owner 直接以 B 店顧客 id 查單筆 → 空陣列（RLS 連存在性都不洩漏）', async () => {
    const { data, error } = await asOwnerA
      .from('customers')
      .select('*')
      .eq('id', SHOP_B.customerB1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A owner 查 tenants → 只看得到自己的店（policy p_tenants_r）', async () => {
    const { data, error } = await asOwnerA.from('tenants').select('id');
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const ids = data!.map((r) => r.id);
    expect(ids).toContain(SHOP_A.id);
    expect(ids).not.toContain(SHOP_B.id);
  });
});
