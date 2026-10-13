import type { SupabaseClient } from '@supabase/supabase-js';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { loadPublicShop } from '@/server/public-shop';

/**
 * 設定進度 SERVICE 步驟：回傳「公開頁可預約」庫存是否至少一筆。
 * 規則全由 MODE_PRESETS[mode].setupInventory 決定，本函式不判斷模式。
 * - table：數租戶下符合條件的列（LOCAL_SHOP／CLINIC 的 services.active=true）。
 * - publicBookablePlans：沿用公開店家頁的方案入口判定（loadPublicShop 的 bookingCta），
 *   fixed／request 才算；店家頁查不到（null）視為 0。查詢錯誤直接往上丟，不吞掉。
 */
export async function countSetupInventory(
  supabase: SupabaseClient,
  tenantId: string,
  businessType: BusinessType,
  shopCode: string,
): Promise<number> {
  const inv = MODE_PRESETS[businessType].setupInventory;
  if (inv.kind === 'publicBookablePlans') {
    const shop = await loadPublicShop(shopCode);
    if (!shop) return 0;
    let n = 0;
    for (const trip of shop.trips) {
      for (const plan of trip.plans) {
        if (plan.bookingCta === 'fixed' || plan.bookingCta === 'request') n += 1;
      }
    }
    return n;
  }
  const { count, error } = await supabase.from(inv.table).select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq(inv.filter.column, inv.filter.value);
  if (error) throw error;
  return count ?? 0;
}
