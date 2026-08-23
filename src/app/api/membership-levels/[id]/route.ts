import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * 重算所有顧客等級（04 分冊 §B-4：等級 CRUD 儲存後執行）。
 * 規則：依 threshold_spent 由高至低比對 customers_view.total_spent（bookings
 * 聚合，customers 本表沒有這欄），取第一個 threshold <= spent 的等級；都不符
 * → null。效能：全量載入後在記憶體分組，按「目標等級」批次 update（每個等級
 * 一條 .in() update，而非逐顧客一條）——顧客數在單店規模（數千）內可接受。
 *
 * ⚠️ 與 ../route.ts 內的同名函式重複：Next route 檔只允許匯出 HTTP handler，
 * 無法從 route.ts 匯出共用函式，而本任務檔案所有權不含 src/server/**。
 */
async function recalcMemberships(t: Awaited<ReturnType<typeof requireTenant>>) {
  const [{ data: levels, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    t.supabase
      .from('membership_levels')
      .select('id, threshold_spent')
      .eq('tenant_id', t.tenantId),
    t.supabase
      .from('customers_view')
      .select('id, total_spent, membership_level_id')
      .eq('tenant_id', t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const sorted = (levels ?? [])
    .map((l: any) => ({ id: l.id as string, threshold: Number(l.threshold_spent) }))
    .sort((a, b) => b.threshold - a.threshold); // 門檻高 → 低

  const moves = new Map<string | null, string[]>();
  for (const c of customers ?? []) {
    const spent = Number(c.total_spent ?? 0);
    const target = sorted.find((l) => l.threshold <= spent)?.id ?? null;
    if (target !== (c.membership_level_id ?? null)) {
      const list = moves.get(target) ?? [];
      list.push(c.id);
      moves.set(target, list);
    }
  }

  for (const [levelId, ids] of moves) {
    const { error } = await t.supabase
      .from('customers')
      .update({ membership_level_id: levelId })
      .eq('tenant_id', t.tenantId)
      .in('id', ids);
    if (error) throw error;
  }
}

/**
 * PUT /api/membership-levels/:id — 更新會員等級（04 分冊 §B-4）⚙M。
 * 所有欄位皆可選；只更新 body 裡實際出現的欄位。儲存後重算所有顧客等級。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入等級名稱').optional(),
  color: z.string().optional(),
  thresholdSpent: z.number().min(0).optional(),
  discountPercent: z.number().min(0).optional(),
  pointRateMultiplier: z.number().min(0).optional(),
  sortOrder: z.number().int().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'MEMBERSHIP_SYSTEM');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.color !== undefined) update.color = b.color;
  if (b.thresholdSpent !== undefined) update.threshold_spent = b.thresholdSpent;
  if (b.discountPercent !== undefined) update.discount_percent = b.discountPercent;
  if (b.pointRateMultiplier !== undefined) update.point_rate_multiplier = b.pointRateMultiplier;
  if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('membership_levels').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此會員等級', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('membership_levels').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此會員等級', ERR.NOT_FOUND);

  await recalcMemberships(t);
  return ok();
});

/**
 * DELETE /api/membership-levels/:id — 刪除會員等級（04 分冊 §B-4）⚙M。
 * customers.membership_level_id FK 為 on delete set null，可直接刪；
 * 刪除後重算讓受影響顧客落到次高符合的等級。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'MEMBERSHIP_SYSTEM');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('membership_levels').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此會員等級', ERR.NOT_FOUND);

  await recalcMemberships(t);
  return ok();
});
