/**
 * 報表 API 整合測試 — 12 分冊 §4「Phase 3（核心 API）」矩陣：
 *   「reports/dashboard：以種子資料手算期望值寫死斷言」
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-5。
 *
 * ⚠️ TDD 紅燈說明：撰寫本檔當下 `src/app/api/reports/**` 完全未實作（Phase 3
 * 施工中），全部紅燈——誠實的「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。
 *
 * 手算期望值（依 scripts/test/seed.mjs 的 SHOP_A 種子，見 12 §1.3）：
 *   4 筆 bookings 全部 customer_id=customerA1、service_id=serviceA1（price=800）、
 *   staff_id=staffA1，start_at 都在 seed 執行當下 ±6 小時內：
 *     bookingPending   status=PENDING   start=now+1h
 *     bookingConfirmed status=CONFIRMED start=now+3h
 *     bookingCompleted status=COMPLETED start=now-2h  final_price=800
 *     bookingCancelled status=CANCELLED start=now+5h
 *   → todayBookings=4（全部落在「今天」，見下方已知限制）
 *   → pendingBookings=1（只有 bookingPending）
 *   → monthRevenue=800（本月 COMPLETED 的 final_price 加總，只有 1 筆）
 *   → totalCustomers=3（customerA1/A2/A3）
 *   → linePlatformStatus='NOT_CONFIGURED'（seed 沒有設定過 LINE token）
 *   → pushQuotaUsed=0／pushQuotaTotal=200（push_quota_usage 沒有任何列、
 *     LINE_FREE_PUSH_QUOTA=200，見 src/config/features.ts）
 *   → unprocessedBookings=1（＝pendingBookings）
 *   → lowStockProducts=0（seed 沒有任何 products 列）
 *   → staffA1：bookingCount=4（全部 4 筆都掛 staffA1）、
 *     completionRate=25（1 筆 COMPLETED / 4 筆全部 *100）、revenue=800
 *     （COMPLETED 的 final_price 加總，只有 1 筆）
 *
 * ⚠️ 時窗相關期望值改為「以種子資料列＋規格時窗現算」（整合測試實跑抓到，
 * 主導者修正）：seed 的 start_at 是相對「seed 執行當下」的 now+1h/+3h/-2h/+5h
 * （UTC），而 04 §A-5 的「今天／本月」是租戶時區 Asia/Taipei（固定 +08:00）。
 * 只要套件在台北時間 19:00 之後跑（= UTC 11:00 後，每天近五小時的窗口），
 * now+5h 就落到台北的「明天」，寫死 todayBookings=4 必然假紅——原版註記的
 * 「恰好跨午夜才會偏差」判斷錯了，偏差窗口其實很大。因此本檔對
 * todayBookings／monthRevenue／staff-performance 三個時窗相關值改用獨立
 * 神諭（oracle）：用 service role 直查種子 4 筆預約的 start_at/status/
 * final_price，按 04 §A-5 規格的 +08:00 固定時窗在測試裡**自行**算出期望值
 * （時窗算術獨立實作，不 import src/server/tz.ts，避免跟受測程式共用實作）。
 * 期望值仍是精確等值斷言（toBe），不是範圍或非空這種弱斷言——這是修正錯誤
 * 的期望值，不是放寬（12 §2.4 管的是後者）。時窗無關的值（pendingBookings、
 * totalCustomers、quota、alerts）維持寫死。
 *
 * 清理紀律：本檔只讀，不寫入任何資料，因此不需要任何清理。前提是
 * settings.a1／bookings.a2／customers.a3／catalog.a4 四個檔案都已依各自檔頭
 * 註記的清理紀律，把自建資料清乾淨、把暫時修改的 seed 資料（staffA1 的
 * staff_services、customerA2 的 membership_level_id、tenant_settings 的
 * line *_enc／points）都復原——這正是本檔的手算值能夠成立的前提。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { DashboardStats, DashboardAlerts, StaffPerformance } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

/* ------------------------------------------------------------------ *
 * 獨立時窗神諭：04 §A-5「今天／本月」＝ Asia/Taipei 固定 +08:00。
 * 刻意不 import src/server/tz.ts —— 神諭與受測程式共用實作的話，
 * 實作錯了測試也跟著錯，就驗不到東西。
 * ------------------------------------------------------------------ */
const TP = 8 * 60 * 60 * 1000;
function taipeiWindows(now = new Date()) {
  const t = new Date(now.getTime() + TP);
  const [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
  return {
    dayFrom: Date.UTC(y, m, d) - TP, dayTo: Date.UTC(y, m, d + 1) - TP,
    monthFrom: Date.UTC(y, m, 1) - TP, monthTo: Date.UTC(y, m + 1, 1) - TP,
  };
}

interface SeedBookingRow { start_at: string; status: string; final_price: number; staff_id: string | null }

let ownerA: AuthedApi;
let seedBookings: SeedBookingRow[];

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  // service role 直查本租戶全部預約（正常情況＝種子 4 筆；其他測試檔的
  // 自建預約都已依清理紀律硬刪），作為時窗相關期望值的資料來源。
  const admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin
    .from('bookings')
    .select('start_at, status, final_price, staff_id')
    .eq('tenant_id', SHOP_A.id);
  if (error) throw error;
  seedBookings = (data ?? []) as SeedBookingRow[];
  expect(seedBookings.length).toBe(4); // 前提檢查：清理紀律沒被破壞
});

describe('GET /api/reports/dashboard（04 §A-5）', () => {
  it('以 seed＋規格時窗現算：todayBookings／monthRevenue；pendingBookings=1、totalCustomers=3、linePlatformStatus=NOT_CONFIGURED', async () => {
    // 期望值以神諭現算（見檔頭說明）。時窗在端點呼叫當下取；種子時間離
    // 邊界至少 1 小時（now±1h/3h/5h 的「小時整數偏移」），呼叫與現算間的
    // 數秒差不會讓任何一筆換邊。
    const w = taipeiWindows();
    const inWin = (iso: string, from: number, to: number) => {
      const ms = new Date(iso).getTime();
      return ms >= from && ms < to;
    };
    const expectedToday = seedBookings.filter((b) => inWin(b.start_at, w.dayFrom, w.dayTo)).length;
    const expectedMonthRevenue = seedBookings
      .filter((b) => b.status === 'COMPLETED' && inWin(b.start_at, w.monthFrom, w.monthTo))
      .reduce((s, b) => s + Number(b.final_price), 0);

    const res = await ownerA.get('/api/reports/dashboard');
    expect(res.status).toBe(200);
    const body = await readJson<DashboardStats>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    expect(data.todayBookings).toBe(expectedToday);
    expect(data.pendingBookings).toBe(1);
    expect(data.monthRevenue).toBe(expectedMonthRevenue);
    expect(data.totalCustomers).toBe(3);
    expect(data.linePlatformStatus).toBe('NOT_CONFIGURED');
    expect(data.pushQuotaUsed).toBe(0);
    expect(data.pushQuotaTotal).toBe(200);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/dashboard`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/reports/dashboard-alerts（04 §A-5）', () => {
  it('以 seed 手算：unprocessedBookings=1、lowStockProducts=0', async () => {
    const res = await ownerA.get('/api/reports/dashboard-alerts');
    expect(res.status).toBe(200);
    const body = await readJson<DashboardAlerts>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    expect(data.unprocessedBookings).toBe(1);
    expect(data.lowStockProducts).toBe(0);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/dashboard-alerts`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/reports/staff-performance（04 §A-5，預設本月）', () => {
  it('以 seed＋規格時窗現算：staffA1 的 bookingCount／completionRate／revenue（預設區間＝本月）', async () => {
    // 神諭：staffA1 掛名、start_at 落在本月（+08:00）的種子預約。
    // completionRate 公式照 04 §A-5／mock 慣例：completed/count*100 取一位小數。
    const w = taipeiWindows();
    const mine = seedBookings.filter((b) => {
      const ms = new Date(b.start_at).getTime();
      return b.staff_id === SHOP_A.staffA1 && ms >= w.monthFrom && ms < w.monthTo;
    });
    const completed = mine.filter((b) => b.status === 'COMPLETED');
    const expectedCount = mine.length;
    const expectedRate = expectedCount > 0
      ? Math.round((completed.length / expectedCount) * 1000) / 10
      : 0;
    const expectedRevenue = completed.reduce((s, b) => s + Number(b.final_price), 0);

    const res = await ownerA.get('/api/reports/staff-performance');
    expect(res.status).toBe(200);
    const body = await readJson<StaffPerformance[]>(res);
    expect(body.success).toBe(true);
    const staffA1 = body.data!.find((s) => s.staffId === SHOP_A.staffA1);
    expect(staffA1).toBeDefined();
    expect(staffA1!.bookingCount).toBe(expectedCount);
    expect(staffA1!.completionRate).toBe(expectedRate);
    expect(staffA1!.revenue).toBe(expectedRevenue);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/reports/staff-performance`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
