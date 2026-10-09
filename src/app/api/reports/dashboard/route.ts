// GET /api/reports/dashboard — DashboardStats（src/lib/types.ts）。
// 「今天／本月」一律以 Asia/Taipei（固定 +08:00）計算，見 src/server/tz.ts。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayRange, taipeiMonthRange, taipeiCurrentMonthKey } from '@/server/tz';
import { pushQuotaLimit } from '@/server/line';
import type { DashboardStats } from '@/lib/types';

export const GET = handle(async () => {
  const t = await requireTenant();
  const { fromIso: todayFrom, toIso: todayTo } = taipeiTodayRange();
  const { fromIso: monthFrom, toIso: monthTo } = taipeiMonthRange();

  const [
    { count: todayBookings, error: e1 },
    { count: pendingBookings, error: e2 },
    { data: completedThisMonth, error: e3 },
    { count: totalCustomers, error: e4 },
    { data: quotaRow, error: e5 },
    { data: settingsRow, error: e6 },
    pushQuotaTotal,
  ] = await Promise.all([
    t.supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).gte('start_at', todayFrom).lt('start_at', todayTo),
    t.supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('status', 'PENDING'),
    // 店家量級小，直接把本月已完成的 final_price 全撈回來在記憶體加總，
    // 不另外寫 rpc（同 A-5 staff-performance 的作法）。
    t.supabase.from('bookings').select('final_price')
      .eq('tenant_id', t.tenantId).eq('status', 'COMPLETED')
      .gte('start_at', monthFrom).lt('start_at', monthTo),
    // 已軟刪（active=false）的顧客不計入儀表板統計。
    t.supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('active', true),
    t.supabase.from('push_quota_usage').select('used')
      .eq('tenant_id', t.tenantId).eq('month', taipeiCurrentMonthKey()).maybeSingle(),
    t.supabase.from('tenant_settings').select('line_channel_access_token_enc')
      .eq('tenant_id', t.tenantId).maybeSingle(),
    pushQuotaLimit(t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;
  if (e5) throw e5;
  if (e6) throw e6;

  const monthRevenue = (completedThisMonth ?? [])
    .reduce((sum, r) => sum + Number(r.final_price), 0);

  const stats: DashboardStats = {
    todayBookings: todayBookings ?? 0,
    pendingBookings: pendingBookings ?? 0,
    monthRevenue,
    totalCustomers: totalCustomers ?? 0,
    pushQuotaUsed: quotaRow?.used ?? 0,
    // 與發送端同一來源：EXTRA_PUSH 生效 700，否則 200（line.ts pushQuotaLimit）。
    pushQuotaTotal,
    // Phase 3 先只用「token 是否已設定」判斷：*_enc 空字串 → NOT_CONFIGURED，
    // 非空 → 直接回 CONNECTED。真正打 LINE `/v2/bot/info` 驗證＋結果快取
    // （才會出現 ERROR 狀態）屬 Phase 6，這裡不打外部 API，避免每次載入
    // dashboard 都對 LINE 平台發一次請求。
    linePlatformStatus: settingsRow?.line_channel_access_token_enc ? 'CONNECTED' : 'NOT_CONFIGURED',
  };
  return ok(stats);
});
