import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * 員工請假（staff_leaves，0005 migration）。types.ts 無對應型別（鐵則 3 不得改），
 * 回應形狀依 mappers 慣例 camelCase：{ id, staffId, startAt, endAt, reason }。
 */
function mapLeave(r: any) {
  return {
    id: r.id as string,
    staffId: r.staff_id as string,
    startAt: r.start_at as string,
    endAt: r.end_at as string,
    reason: (r.reason ?? '') as string,
  };
}

/** 先確認 :id 員工存在且屬於本租戶（404 規則）。 */
async function requireStaff(t: Awaited<ReturnType<typeof requireTenant>>, staffId: string) {
  const { data, error } = await t.supabase
    .from('staff').select('id').eq('id', staffId).eq('tenant_id', t.tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此員工', ERR.NOT_FOUND);
}

/** GET /api/staff/:id/leaves — 該員工全部請假，start_at asc（班表顯示順序）。 */
export const GET = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  await requireStaff(t, id);

  const { data, error } = await t.supabase
    .from('staff_leaves')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .eq('staff_id', id)
    .order('start_at', { ascending: true });
  if (error) throw error;

  return ok(data.map(mapLeave));
});

/** POST /api/staff/:id/leaves — 新增請假 {startAt, endAt, reason?}，endAt 需晚於 startAt。 */
const isoDatetime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), '時間格式錯誤');

const createSchema = z
  .object({ startAt: isoDatetime, endAt: isoDatetime, reason: z.string().optional() })
  .refine((b) => Date.parse(b.endAt) > Date.parse(b.startAt), '結束時間需晚於開始時間');

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = createSchema.parse(await req.json());
  await requireStaff(t, id);

  const { data, error } = await t.supabase
    .from('staff_leaves')
    .insert({
      tenant_id: t.tenantId,
      staff_id: id,
      start_at: b.startAt,
      end_at: b.endAt,
      reason: b.reason ?? '',
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
