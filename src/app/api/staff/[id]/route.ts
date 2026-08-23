import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/staff/:id — 更新員工 ⚙M（04 分冊 §B-2）。
 * 所有欄位皆可選，只更新 body 裡實際出現的欄位；
 * serviceIds 有出現（含空陣列）→ 先寫 staff 再「全刪重插」staff_services。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入員工姓名').optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  avatarUrl: z.string().optional(),
  bookable: z.boolean().optional(),
  active: z.boolean().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: existing, error: e0 } = await t.supabase
    .from('staff').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此員工', ERR.NOT_FOUND);

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.phone !== undefined) update.phone = b.phone;
  if (b.email !== undefined) update.email = b.email;
  if (b.title !== undefined) update.title = b.title;
  if (b.avatarUrl !== undefined) update.avatar_url = b.avatarUrl;
  if (b.bookable !== undefined) update.bookable = b.bookable;
  if (b.active !== undefined) update.active = b.active;

  if (Object.keys(update).length > 0) {
    const { error } = await t.supabase
      .from('staff').update(update).eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  if (b.serviceIds !== undefined) {
    const serviceIds = [...new Set(b.serviceIds)];
    if (serviceIds.length > 0) {
      const { data: svcs, error: eS } = await t.supabase
        .from('services').select('id').eq('tenant_id', t.tenantId).in('id', serviceIds);
      if (eS) throw eS;
      if ((svcs ?? []).length !== serviceIds.length)
        throw new ApiHttpError(400, '包含無效的服務項目', ERR.VALIDATION);
    }

    const { error: eD } = await t.supabase
      .from('staff_services').delete().eq('staff_id', id).eq('tenant_id', t.tenantId);
    if (eD) throw eD;

    if (serviceIds.length > 0) {
      const { error: eI } = await t.supabase.from('staff_services').insert(
        serviceIds.map((sid) => ({ staff_id: id, service_id: sid, tenant_id: t.tenantId })),
      );
      if (eI) throw eI;
    }
  }

  return ok();
});

/**
 * DELETE /api/staff/:id — 刪除員工 ⚙M。同 services 的未來預約檢查
 * （bookings.staff_id，start_at > now 且 PENDING/CONFIRMED）→ 有則改
 * active=false 並在 message 說明「已改為停用」；無則真刪
 * （bookings.staff_id 為 on delete set null，staff_services/shifts/staff_leaves
 * 皆 cascade，硬刪不會撞 FK）。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('staff').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此員工', ERR.NOT_FOUND);

  const { data: future, error: e1 } = await t.supabase
    .from('bookings').select('id')
    .eq('tenant_id', t.tenantId).eq('staff_id', id)
    .in('status', ['PENDING', 'CONFIRMED'])
    .gt('start_at', new Date().toISOString())
    .limit(1);
  if (e1) throw e1;

  if (future && future.length > 0) {
    const { error } = await t.supabase
      .from('staff').update({ active: false }).eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
    // 信封允許成功回應帶 message；ok() 不收 message，故直接組。
    return NextResponse.json({
      success: true,
      data: { deactivated: true },
      message: '此員工尚有未來預約，已改為停用',
    });
  }

  const { error } = await t.supabase
    .from('staff').delete().eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok({ deleted: true });
});
