import type { SupabaseClient } from '@supabase/supabase-js';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';

const PAGE = 100;
const MAX_PAGES = 10;

/**
 * 設定進度 SERVICE 步驟：回傳「公開頁可預約」庫存是否至少一筆。
 * 規則全由 MODE_PRESETS[mode].setupInventory 決定，本函式不判斷模式。
 * 有 requireActiveChild 時：先取租戶下符合條件的父列 id，再數這些 id 底下啟用的子列
 * （分頁最多 MAX_PAGES * PAGE 個父列，足以涵蓋實際店家）。
 */
export async function countSetupInventory(
  supabase: SupabaseClient,
  tenantId: string,
  businessType: BusinessType,
): Promise<number> {
  const inv = MODE_PRESETS[businessType].setupInventory;
  const child = inv.requireActiveChild;
  if (!child) {
    const { count, error } = await supabase.from(inv.table).select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq(inv.filter.column, inv.filter.value);
    if (error) throw error;
    return count ?? 0;
  }
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.from(inv.table).select('id')
      .eq('tenant_id', tenantId).eq(inv.filter.column, inv.filter.value)
      .order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return 0;
    const { count, error: cerr } = await supabase.from(child.table).select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in(child.fk, ids).eq(child.filter.column, child.filter.value);
    if (cerr) throw cerr;
    if ((count ?? 0) > 0) return count ?? 0;
    if (ids.length < PAGE) return 0;
  }
  return 0;
}
