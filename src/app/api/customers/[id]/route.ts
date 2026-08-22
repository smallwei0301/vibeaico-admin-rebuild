import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const genderInput = z.union([z.literal(''), z.enum(['MALE', 'FEMALE', 'OTHER'])]).optional();

/**
 * PUT /api/customers/:id — 所有欄位皆可選；只更新 body 裡實際出現的欄位
 * （zod 解析後 undefined = 未出現，跳過；''（gender/birthday/membershipLevelId）
 * = 明確清空存 null，其餘欄位（not null default ''）可直接存 ''）。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入姓名').optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  gender: genderInput,
  birthday: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  membershipLevelId: z.string().optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const update: Record<string, unknown> = {};
  if (b.name !== undefined) update.name = b.name;
  if (b.phone !== undefined) update.phone = b.phone;
  if (b.email !== undefined) update.email = b.email;
  if (b.gender !== undefined) update.gender = b.gender ? b.gender : null;
  if (b.birthday !== undefined) update.birthday = b.birthday ? b.birthday : null;
  if (b.note !== undefined) update.note = b.note;
  if (b.tags !== undefined) update.tags = b.tags;
  if (b.membershipLevelId !== undefined)
    update.membership_level_id = b.membershipLevelId ? b.membershipLevelId : null;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('customers').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
    return ok();
  }

  const { data, error } = await t.supabase
    .from('customers').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);

  return ok();
});

/**
 * DELETE /api/customers/:id — 有 PENDING/CONFIRMED 預約 → 409 CONFLICT；
 * 否則軟刪 active=false（bookings.customer_id 為 FK restrict，不能硬刪）。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('customers').select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);

  const { data: activeBookings, error: e1 } = await t.supabase
    .from('bookings').select('id')
    .eq('tenant_id', t.tenantId).eq('customer_id', id)
    .in('status', ['PENDING', 'CONFIRMED']).limit(1);
  if (e1) throw e1;
  if (activeBookings && activeBookings.length > 0)
    throw new ApiHttpError(409, '此顧客尚有進行中的預約，無法刪除', ERR.CONFLICT);

  const { error } = await t.supabase
    .from('customers').update({ active: false }).eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok();
});
