import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant, requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripPlan } from '@/server/mappers';
import { planCreateSchema, planRow } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

async function requireTrip(t: Awaited<ReturnType<typeof requireTenant>>, id: string) {
  const { data, error } = await t.supabase.from('trips').select('id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return true;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  if (!await requireTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_plans').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id).order('sort_order', { ascending: true });
  if (error) throw error;
  return ok((data ?? []).map(mapTripPlan));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = planCreateSchema.parse(await req.json());
  if (!await requireTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { count, error: countError } = await t.supabase.from('trip_plans')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', t.tenantId).eq('trip_id', id);
  if (countError) throw countError;
  // 21 分冊 §6：代登入下建立的資料自動標成 PLATFORM_ASSISTED，由伺服器端決定，
  // 不接受客戶端傳入（`planCreateSchema` 沒有 source 欄位）。只是來源標記，不改權限。
  const source = t.impersonation ? 'PLATFORM_ASSISTED' : 'GUIDE';
  const { data, error } = await t.supabase.from('trip_plans')
    .insert(planRow(body, t.tenantId, id, count ?? 0, source)).select('*').single();
  if (error) throw error;
  return ok(mapTripPlan(data));
});
