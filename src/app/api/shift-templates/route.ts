import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * 班別模板（shift_templates，0005 migration：id/tenant_id/name/start_time/
 * end_time/color，無 sort_order）。types.ts 無對應型別（鐵則 3 不得改），
 * 回應依 mappers 慣例 camelCase：{ id, name, startTime, endTime, color }。
 * postgres time 欄位回 'HH:MM:SS'，前端（/tenant/shifts）用 'HH:mm' → 切前 5 碼。
 */
function mapShiftTemplate(r: any) {
  return {
    id: r.id as string,
    name: r.name as string,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
    color: r.color as string,
  };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式需為 HH:mm');

/** GET /api/shift-templates — 全量不分頁；無 sort_order 欄位，以 start_time asc 排。 */
export const GET = handle(async () => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'SHIFT_MANAGEMENT');

  const { data, error } = await t.supabase
    .from('shift_templates')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('start_time', { ascending: true });
  if (error) throw error;

  return ok(data.map(mapShiftTemplate));
});

/** POST /api/shift-templates — 新增班別 {name, startTime, endTime, color?}。 */
const createSchema = z
  .object({
    name: z.string().min(1, '請輸入班別名稱'),
    startTime: hhmm,
    endTime: hhmm,
    color: z.string().optional(),
  })
  .refine((b) => b.endTime > b.startTime, '結束時間需晚於開始時間');

export const POST = handle(async (req) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'SHIFT_MANAGEMENT');
  const b = createSchema.parse(await req.json());

  const insert: Record<string, unknown> = {
    tenant_id: t.tenantId,
    name: b.name,
    start_time: b.startTime,
    end_time: b.endTime,
  };
  if (b.color !== undefined) insert.color = b.color; // 未帶 → 用 DB default '#4A90D9'

  const { data, error } = await t.supabase
    .from('shift_templates').insert(insert).select('id').single();
  if (error) throw error;

  return ok({ id: data.id });
});
