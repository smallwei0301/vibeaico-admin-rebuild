// PUT /api/block-times/:id — 編輯封鎖時段；DELETE /api/block-times/:id — 刪除（#169）。
// auto = true（「每天不同營業時間」自動產生）的列禁止編輯與刪除，一律 409。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { blockTimeWriteSchema, validateBlockTimeTimes } from '@/server/block-times';

const AUTO_LOCKED_MESSAGE = '自動產生的休息時段無法編輯或刪除，請至「營運時間」調整每天不同的營業時間設定';

type Tenant = Awaited<ReturnType<typeof requireTenant>>;

async function loadOwnedRow(supabase: Tenant['supabase'], tenantId: string, id: string) {
  const { data, error } = await supabase.from('block_times')
    .select('id, auto').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此封鎖時段', ERR.NOT_FOUND);
  if (data.auto) throw new ApiHttpError(409, AUTO_LOCKED_MESSAGE, ERR.CONFLICT);
  return data;
}

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  await loadOwnedRow(t.supabase, t.tenantId, id);

  const b = blockTimeWriteSchema.parse(await req.json());
  const { recurrence, dayOfWeek } = validateBlockTimeTimes(b);

  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  const { error } = await t.supabase.from('block_times')
    .update({
      staff_id: b.staffId ?? null,
      title: b.title ?? '',
      reason: b.reason ?? '',
      recurrence,
      day_of_week: dayOfWeek,
      full_day: b.fullDay ?? false,
      start_at: new Date(Date.parse(b.startAt)).toISOString(),
      end_at: new Date(Date.parse(b.endAt)).toISOString(),
    })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;
  return ok();
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  await loadOwnedRow(t.supabase, t.tenantId, id);

  const { error } = await t.supabase.from('block_times')
    .delete()
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;
  return ok();
});
