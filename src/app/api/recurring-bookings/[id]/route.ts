// PUT/DELETE /api/recurring-bookings/:id — 週期性預約更新/刪除（04 §B-1）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/, '時間格式須為 HH:mm'),
  intervalWeeks: z.number().int().min(1),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '結束日期格式須為 YYYY-MM-DD'),
});

/** 全部可選，只更新 body 裡出現的欄位（staffId null = 清除指定員工） */
const bodySchema = z.object({
  customerId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  staffId: z.string().uuid().nullable().optional(),
  rule: ruleSchema.optional(),
  active: z.boolean().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.customerId !== undefined) {
    const { data, error } = await t.supabase.from('customers').select('id')
      .eq('id', b.customerId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
    update.customer_id = b.customerId;
  }
  if (b.serviceId !== undefined) {
    const { data, error } = await t.supabase.from('services').select('id')
      .eq('id', b.serviceId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
    update.service_id = b.serviceId;
  }
  if (b.staffId !== undefined) {
    if (b.staffId) {
      const { data, error } = await t.supabase.from('staff').select('id')
        .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
    }
    update.staff_id = b.staffId;
  }
  if (b.rule !== undefined) update.rule = b.rule;
  if (b.active !== undefined) update.active = b.active;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase.from('recurring_bookings')
      .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此週期性預約', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase.from('recurring_bookings')
    .update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此週期性預約', ERR.NOT_FOUND);
  return ok();
});

// 已由 renew 產生的實體 bookings 不參照 recurring_bookings（bookings 表沒有
// 對應 FK，只有 source='RECURRING' 標記），可安全硬刪；已產生的預約留存。
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data, error } = await t.supabase.from('recurring_bookings')
    .delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此週期性預約', ERR.NOT_FOUND);
  return ok();
});
