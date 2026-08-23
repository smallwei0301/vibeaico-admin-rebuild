import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/services/:id — 更新服務 ⚙M。所有欄位皆可選，只更新 body 裡實際
 * 出現的欄位（undefined = 未出現，跳過）；categoryId '' = 明確清空存 null。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入服務名稱').optional(),
  categoryId: z.string().optional(),
  description: z.string().optional(),
  durationMinutes: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  imageUrl: z.string().optional(),
  active: z.boolean().optional(),
  lineFeatured: z.boolean().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.categoryId !== undefined) update.category_id = b.categoryId ? b.categoryId : null;
  if (b.description !== undefined) update.description = b.description;
  if (b.durationMinutes !== undefined) update.duration_minutes = b.durationMinutes;
  if (b.price !== undefined) update.price = b.price;
  if (b.imageUrl !== undefined) update.image_url = b.imageUrl;
  if (b.active !== undefined) update.active = b.active;
  if (b.lineFeatured !== undefined) update.line_featured = b.lineFeatured;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('services').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('services').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);

  return ok();
});

/**
 * DELETE /api/services/:id — 刪除服務 ⚙M（04 分冊 §B-2）。
 * 有未來（start_at > now）PENDING/CONFIRMED 預約 → 改 active=false，
 * 回應 message 說明「已改為停用」；無 → 真刪。
 *
 * 補充（DB 為準）：bookings.service_id 為 FK restrict，歷史預約也會擋硬刪 —
 * 真刪撞 FK（23503）時同樣退回 active=false + message，不回 500。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('services').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);

  const { data: future, error: e1 } = await t.supabase
    .from('bookings').select('id')
    .eq('tenant_id', t.tenantId).eq('service_id', id)
    .in('status', ['PENDING', 'CONFIRMED'])
    .gt('start_at', new Date().toISOString())
    .limit(1);
  if (e1) throw e1;

  const deactivate = async (message: string) => {
    const { error } = await t.supabase
      .from('services').update({ active: false }).eq('id', id).eq('tenant_id', t.tenantId);
    if (error) throw error;
    // 信封允許成功回應帶 message（{success, data?, message?}）；ok() 不收 message，故直接組。
    return NextResponse.json({ success: true, data: { deactivated: true }, message });
  };

  if (future && future.length > 0)
    return deactivate('此服務尚有未來預約，已改為停用');

  const { error } = await t.supabase
    .from('services').delete().eq('id', id).eq('tenant_id', t.tenantId);
  if (error) {
    if ((error as any).code === '23503')
      return deactivate('此服務已有預約紀錄，已改為停用');
    throw error;
  }

  return ok({ deleted: true });
});
