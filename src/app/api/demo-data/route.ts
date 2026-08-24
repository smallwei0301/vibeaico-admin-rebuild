import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { DEMO_TAG, seedDemoData } from '@/server/demo-seed';
import type { BusinessType } from '@/config/modes';

/**
 * 示範資料的建立與清空（首頁「一鍵清空」用）。
 *
 * GET    /api/demo-data — 回目前還有幾筆示範資料（首頁決定要不要顯示清空按鈕）
 * POST   /api/demo-data — 依業態補上示範資料（註冊時會自動呼叫；這裡另外開一支
 *                          給「清空後想再看一次範例」的情況）
 * DELETE /api/demo-data — 清空示範資料
 *
 * 判定「哪些是示範資料」一律用名稱前綴 DEMO_TAG，理由見 demo-seed.ts 檔頭：
 * 店家把名稱改掉 = 認養這筆資料，之後就不會被清空掃到，這正是想要的語意。
 */

/** 各表以名稱前綴撈出示範資料的 id。 */
async function demoCounts(supabase: any, tenantId: string) {
  const like = `${DEMO_TAG}%`;
  const tables = ['services', 'staff', 'products', 'trips'] as const;
  const entries = await Promise.all(tables.map(async (table) => {
    const { count } = await supabase.from(table)
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).like('name', like);
    return [table, count ?? 0] as const;
  }));
  return Object.fromEntries(entries) as Record<(typeof tables)[number], number>;
}

export const GET = handle(async () => {
  const t = await requireTenant();
  const counts = await demoCounts(t.supabase, t.tenantId);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return ok({ total, counts });
});

export const POST = handle(async () => {
  const t = await requireTenant('MANAGER');

  const counts = await demoCounts(t.supabase, t.tenantId);
  if (Object.values(counts).reduce((a, b) => a + b, 0) > 0) {
    return ok({ seeded: false, skipped: true });
  }

  const { data: tenant } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();

  await seedDemoData(t.tenantId, (tenant?.business_type ?? 'LOCAL_SHOP') as BusinessType);
  return ok({ seeded: true });
});

/**
 * 清空示範資料。
 *
 * trips 先刪（trip_plans 由 FK on delete cascade 一併移除）。
 * 刻意**不**動 bookings / customers：那些是店家自己在示範資料上做的操作紀錄，
 * 清示範資料不該連他的測試預約一起消失；而殘留的預約仍指向已刪除的服務時，
 * 既有查詢都是 left join，不會炸掉。
 */
export const DELETE = handle(async () => {
  const t = await requireTenant('MANAGER');
  const like = `${DEMO_TAG}%`;

  const deleted: Record<string, number> = {};
  for (const table of ['trips', 'services', 'staff', 'products'] as const) {
    const { data, error } = await t.supabase.from(table)
      .delete().eq('tenant_id', t.tenantId).like('name', like).select('id');
    if (error) throw error;
    deleted[table] = data?.length ?? 0;
  }

  return ok({ cleared: true, deleted });
});
