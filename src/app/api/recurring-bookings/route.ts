// GET/POST /api/recurring-bookings — 週期性預約（04 §B-1）。
// rule jsonb = { weekday(0-6，0=週日), time 'HH:mm', intervalWeeks, until 'YYYY-MM-DD' }
// （0005 migration recurring_bookings.rule 的註解欄位）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/, '時間格式須為 HH:mm'),
  intervalWeeks: z.number().int().min(1),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '結束日期格式須為 YYYY-MM-DD'),
});

const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  rule: ruleSchema,
});

/** recurring_bookings 沒有前端契約型別（types.ts 只准新增 CalendarEvent），照 mappers.ts 慣例就地轉 camelCase */
function mapRecurringBooking(r: any) {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customers?.name ?? '', // 巢狀 join 實際為多對一物件（同 notify.ts 說明）
    serviceId: r.service_id,
    serviceName: r.services?.name ?? '',
    staffId: r.staff_id,
    staffName: r.staff?.name ?? null,
    rule: r.rule,
    active: r.active,
    createdAt: r.created_at,
  };
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  void req;
  const { data, error } = await t.supabase.from('recurring_bookings')
    .select('id, customer_id, service_id, staff_id, rule, active, created_at, customers(name), services(name), staff(name)')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ok((data ?? []).map(mapRecurringBooking));
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = createSchema.parse(await req.json());

  // 404 規則（04 §0 第 7 條）：關聯 id 查無或屬別店 → 404
  const [{ data: customer, error: cErr }, { data: service, error: sErr }] = await Promise.all([
    t.supabase.from('customers').select('id')
      .eq('id', b.customerId).eq('tenant_id', t.tenantId).maybeSingle(),
    t.supabase.from('services').select('id')
      .eq('id', b.serviceId).eq('tenant_id', t.tenantId).maybeSingle(),
  ]);
  if (cErr) throw cErr;
  if (sErr) throw sErr;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
  if (!service) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  const { data, error } = await t.supabase.from('recurring_bookings')
    .insert({
      tenant_id: t.tenantId,
      customer_id: b.customerId,
      service_id: b.serviceId,
      staff_id: b.staffId ?? null,
      rule: b.rule,
    })
    .select('id').single();
  if (error) throw error;
  return ok({ id: data.id });
});
