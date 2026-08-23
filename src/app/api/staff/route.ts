import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapStaff } from '@/server/mappers';

/**
 * GET /api/staff — staff + staff_services 聚合成 service_ids（多對多）。
 * 全量不分頁，sort_order asc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('staff')
    .select('*, staff_services(service_id)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapStaff({ ...r, service_ids: (r.staff_services ?? []).map((s: any) => s.service_id) }),
    ),
  );
});

/**
 * POST /api/staff — 新增員工 ⚙M（04 分冊 §B-2）。
 * body 含 serviceIds[] → 先寫 staff 再寫 staff_services（新增時無舊資料，直接插）。
 * serviceIds 需全部屬於本租戶（否則 400），避免掛到別店的服務。
 */
const createSchema = z.object({
  name: z.string().min(1, '請輸入員工姓名'),
  phone: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  avatarUrl: z.string().optional(),
  bookable: z.boolean().optional(),
  active: z.boolean().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const serviceIds = [...new Set(b.serviceIds ?? [])];
  if (serviceIds.length > 0) {
    const { data: svcs, error: eS } = await t.supabase
      .from('services').select('id').eq('tenant_id', t.tenantId).in('id', serviceIds);
    if (eS) throw eS;
    if ((svcs ?? []).length !== serviceIds.length)
      throw new ApiHttpError(400, '包含無效的服務項目', ERR.VALIDATION);
  }

  const { data: last, error: e0 } = await t.supabase
    .from('staff')
    .select('sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e0) throw e0;

  const { data, error } = await t.supabase
    .from('staff')
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      phone: b.phone ?? '',
      email: b.email ?? '',
      title: b.title ?? '',
      avatar_url: b.avatarUrl ?? '',
      bookable: b.bookable ?? true,
      active: b.active ?? true,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  if (serviceIds.length > 0) {
    const { error: eL } = await t.supabase.from('staff_services').insert(
      serviceIds.map((sid) => ({ staff_id: data.id, service_id: sid, tenant_id: t.tenantId })),
    );
    if (eL) throw eL;
  }

  return ok({ id: data.id });
});
