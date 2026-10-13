import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import type { SetupStatus } from '@/lib/types';
import { countSetupInventory } from '@/server/setup-inventory';

/**
 * GET /api/settings/setup-status — 回 SetupStatus。
 * 判定規則照 04 分冊 A-1：
 *   SHOP_INFO       basic.tenantPhone 或 tenantAddress 有值
 *   STAFF           staff 至少 1 筆
 *   SERVICE         依模式：services（LOCAL_SHOP／CLINIC，active）或 trips（GUIDE，PUBLISHED）
 *                   至少 1 筆「公開頁可預約」的庫存（MODE_PRESETS.setupInventory，
 *                   與 public-shop 的可見條件一致；草稿行程、無啟用方案的行程不算）
 *   BUSINESS_HOURS  business jsonb ≠ '{}'（曾儲存過）
 *   LINE_BOT        line_channel_access_token_enc 非空
 * percent = done 數 / 5 * 100（整數）
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const [{ data: settingsRow, error: serr }, { count: staffCount, error: staffErr },
    serviceCount] = await Promise.all([
    t.supabase.from('tenant_settings')
      .select('basic, business, line_channel_access_token_enc')
      .eq('tenant_id', t.tenantId).maybeSingle(),
    t.supabase.from('staff').select('id', { count: 'exact', head: true }).eq('tenant_id', t.tenantId),
    countSetupInventory(t.supabase, t.tenantId, t.businessType),
  ]);
  if (serr) throw serr;
  if (staffErr) throw staffErr;

  const basic = (settingsRow?.basic ?? {}) as Record<string, unknown>;
  const business = (settingsRow?.business ?? {}) as Record<string, unknown>;

  const steps: SetupStatus['steps'] = [
    { key: 'SHOP_INFO', done: Boolean(basic.tenantPhone || basic.tenantAddress) },
    { key: 'STAFF', done: (staffCount ?? 0) > 0 },
    { key: 'SERVICE', done: serviceCount > 0 },
    { key: 'BUSINESS_HOURS', done: Object.keys(business).length > 0 },
    { key: 'LINE_BOT', done: Boolean(settingsRow?.line_channel_access_token_enc) },
  ];
  const done = steps.filter((s) => s.done).length;

  return ok<SetupStatus>({ percent: Math.round((done / 5) * 100), steps });
});
