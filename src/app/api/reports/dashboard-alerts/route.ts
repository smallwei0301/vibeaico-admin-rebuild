// GET /api/reports/dashboard-alerts — DashboardAlerts（src/lib/types.ts）。
// 「今天」以 Asia/Taipei（固定 +08:00）計算，見 src/server/tz.ts。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { taipeiTodayDateString, taipeiCurrentMonthKey } from '@/server/tz';
import { businessSettingsSchema } from '@/config/tenant-settings';
import { LINE_FREE_PUSH_QUOTA, FEATURE_EXPIRY_WARNING_DAYS } from '@/config/features';
import type { DashboardAlerts } from '@/lib/types';

export const GET = handle(async () => {
  const t = await requireTenant();

  const [
    { count: unprocessedBookings, error: e1 },
    // Supabase 的 filter 語法無法直接比較兩個欄位（stock <= safety_stock），
    // 店家量級小，撈 active 商品的 stock/safety_stock 回來在記憶體比對即可。
    { data: productsForStock, error: e2 },
    { count: atRiskCustomers, error: e3 },
    { data: settingsRow, error: e4 },
    { data: quotaRow, error: e5 },
    { data: featureRows, error: e6 },
  ] = await Promise.all([
    t.supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('status', 'PENDING'),
    t.supabase.from('products').select('stock, safety_stock')
      .eq('tenant_id', t.tenantId).eq('active', true),
    t.supabase.from('customers_view').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('at_risk', true),
    t.supabase.from('tenant_settings').select('business')
      .eq('tenant_id', t.tenantId).maybeSingle(),
    t.supabase.from('push_quota_usage').select('used')
      .eq('tenant_id', t.tenantId).eq('month', taipeiCurrentMonthKey()).maybeSingle(),
    t.supabase.from('feature_subscriptions').select('code, active, expires_at')
      .eq('tenant_id', t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;
  if (e5) throw e5;
  if (e6) throw e6;

  const lowStockProducts = (productsForStock ?? [])
    .filter((p) => Number(p.stock) <= Number(p.safety_stock)).length;

  const business = businessSettingsSchema.parse(settingsRow?.business ?? {});
  // bookingCutoffDate 是純日期字串（'' = 未設定）。schema 裡沒有另外的
  // 「截止提醒開關」欄位，因此「未設定」一律視為未過期（false / null），
  // 已設定則跟 Asia/Taipei 今天比較，比今天早即視為已過期。
  const bookingCutoffDate = business.bookingCutoffDate || null;
  const bookingCutoffPassed = bookingCutoffDate !== null && bookingCutoffDate < taipeiTodayDateString();

  const pushQuotaExhausted = (quotaRow?.used ?? 0) >= LINE_FREE_PUSH_QUOTA;

  const now = Date.now();
  const warnMs = FEATURE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  const expiredFeatures: string[] = [];
  const expiringFeatures: { code: string; expiresAt: string }[] = [];
  for (const r of featureRows ?? []) {
    // 只看「曾經訂閱（active=true）且有到期日」的：expires_at 為 null＝永久，不算。
    if (!r.active || !r.expires_at) continue;
    const expiresAtMs = new Date(r.expires_at).getTime();
    if (expiresAtMs <= now) expiredFeatures.push(r.code);
    else if (expiresAtMs - now <= warnMs) expiringFeatures.push({ code: r.code, expiresAt: r.expires_at });
  }

  const alerts: DashboardAlerts = {
    unprocessedBookings: unprocessedBookings ?? 0,
    lowStockProducts,
    atRiskCustomers: atRiskCustomers ?? 0,
    bookingCutoffPassed,
    bookingCutoffDate,
    pushQuotaExhausted,
    expiredFeatures,
    expiringFeatures,
  };
  return ok(alerts);
});
