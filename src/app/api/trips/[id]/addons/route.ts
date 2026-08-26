import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripAddon } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 行程加購項（10 分冊 §5 的 2026-08-24 補記：「前端 services/tours.ts 與詳情頁
 * UI 已存在，原規格漏列」）。schema 見 migration 0026。
 *
 * GET  /api/trips/[id]/addons — 列出該行程的加購項
 * POST /api/trips/[id]/addons — 新增 ⚙M
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant();

  const { data: trip, error: terr } = await t.supabase
    .from('trips').select('id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (terr) throw terr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { data, error } = await t.supabase
    .from('trip_addons').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok((data ?? []).map(mapTripAddon));
});

const createSchema = z.object({
  name: z.string().min(1, '請輸入加購項名稱'),
  price: z.number().min(0, '價格不得為負數'),
  unit: z.enum(['PER_PERSON', 'PER_GROUP']).optional(),
  // null = 不限量。`nullable().optional()` 兩者語意不同：null 是明確的「不限量」，
  // undefined 是「這次沒送這個欄位」。
  stock: z.number().int('庫存必須為整數').min(0, '庫存不得為負數').nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const { data: trip, error: terr } = await t.supabase
    .from('trips').select('id').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (terr) throw terr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  // 沒給 sortOrder 就接在最後面（現有筆數），與方案的作法一致
  let sortOrder = b.sortOrder;
  if (sortOrder === undefined) {
    const { count } = await t.supabase
      .from('trip_addons').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('trip_id', id);
    sortOrder = count ?? 0;
  }

  const { data, error } = await t.supabase.from('trip_addons').insert({
    tenant_id: t.tenantId,
    trip_id: id,
    name: b.name,
    price: b.price,
    unit: b.unit ?? 'PER_PERSON',
    stock: b.stock ?? null,
    active: b.active ?? true,
    sort_order: sortOrder,
  }).select('*').single();
  if (error) throw error;

  return ok(mapTripAddon(data));
});
