import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * 班表（shifts，0005 migration：staff_id/work_date/template_id/start_time/end_time，
 * 唯一鍵 (tenant_id, staff_id, work_date, start_time)）。types.ts 無對應型別
 * （鐵則 3 不得改），回應依 mappers 慣例 camelCase：
 * { id, staffId, workDate, templateId, startTime, endTime }。
 * postgres time 回 'HH:MM:SS' → 切前 5 碼成 'HH:mm'（前端 /tenant/shifts 的格式）。
 */
function mapShift(r: any) {
  return {
    id: r.id as string,
    staffId: r.staff_id as string,
    workDate: r.work_date as string,
    templateId: (r.template_id ?? null) as string | null,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
  };
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式需為 HH:mm');

/** GET /api/shifts?from&to — 區間內全部班表（不分頁），work_date asc、start_time asc。 */
const querySchema = z
  .object({ from: dateStr, to: dateStr, staffId: z.string().uuid().optional() })
  .refine((q) => q.from <= q.to, 'from 不可晚於 to');

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  let query = t.supabase
    .from('shifts')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .gte('work_date', q.from)
    .lte('work_date', q.to)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (q.staffId) query = query.eq('staff_id', q.staffId);

  const { data, error } = await query;
  if (error) throw error;

  return ok(data.map(mapShift));
});

/**
 * POST /api/shifts — 批次 upsert（04 分冊 §B-2「body 陣列」）。
 * body = [{staffId, workDate, startTime, endTime, templateId?}]，
 * onConflict = 表的唯一鍵 (tenant_id, staff_id, work_date, start_time)：
 * 同員工同日同起始時間已存在 → 覆蓋 end_time/template_id，否則新增。
 * staffId/templateId 需全部屬於本租戶（400/404），避免跨店掛班。
 */
const itemSchema = z
  .object({
    staffId: z.string().uuid(),
    workDate: dateStr,
    startTime: hhmm,
    endTime: hhmm,
    templateId: z.string().uuid().nullish(),
  })
  .refine((i) => i.endTime > i.startTime, '結束時間需晚於開始時間');

const batchSchema = z.array(itemSchema).min(1, '請提供至少一筆班表').max(500, '單次最多 500 筆');

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const items = batchSchema.parse(await req.json());

  const staffIds = [...new Set(items.map((i) => i.staffId))];
  const { data: staffRows, error: eS } = await t.supabase
    .from('staff').select('id').eq('tenant_id', t.tenantId).in('id', staffIds);
  if (eS) throw eS;
  if ((staffRows ?? []).length !== staffIds.length)
    throw new ApiHttpError(400, '包含無效的員工', ERR.VALIDATION);

  const templateIds = [...new Set(items.map((i) => i.templateId).filter((x): x is string => !!x))];
  if (templateIds.length > 0) {
    const { data: tplRows, error: eT } = await t.supabase
      .from('shift_templates').select('id').eq('tenant_id', t.tenantId).in('id', templateIds);
    if (eT) throw eT;
    if ((tplRows ?? []).length !== templateIds.length)
      throw new ApiHttpError(400, '包含無效的班別模板', ERR.VALIDATION);
  }

  const { error } = await t.supabase.from('shifts').upsert(
    items.map((i) => ({
      tenant_id: t.tenantId,
      staff_id: i.staffId,
      work_date: i.workDate,
      start_time: i.startTime,
      end_time: i.endTime,
      template_id: i.templateId ?? null,
    })),
    { onConflict: 'tenant_id,staff_id,work_date,start_time' },
  );
  if (error) throw error;

  return ok({ count: items.length });
});
