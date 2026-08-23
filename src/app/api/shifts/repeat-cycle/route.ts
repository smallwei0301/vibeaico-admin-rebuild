import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/shifts/repeat-cycle — 依週模式展開寫入（04 分冊 §B-2）。
 *
 * body：{ staffId, weekPattern, from, to }
 *
 * weekPattern 結構（自行設計，契約未定）：
 *   Record<'0'..'6', templateId | null>，key = JS Date#getDay() 的星期
 *   （0=週日 … 6=週六），value 三態：
 *     - templateId（uuid）：該星期套用此班別（start/end 取模板時間）
 *     - null：該星期為休假日 → 清掉區間內該日已存在的班
 *     - key 不出現：該星期不套用模式，既有班表原樣保留
 *
 * 寫入語意 = 「模式覆蓋」：對 weekPattern 有出現的星期，區間內該日先整日
 * 刪除舊班再插入新班（表的唯一鍵含 start_time，用 upsert 會在起始時間改變時
 * 留下同日兩筆殘班，故採 delete-then-insert）。區間上限 366 天。
 */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD');

const bodySchema = z
  .object({
    staffId: z.string().uuid(),
    weekPattern: z.record(
      z.string().regex(/^[0-6]$/, 'weekPattern 的 key 需為 0-6（0=週日）'),
      z.string().uuid().nullable(),
    ),
    from: dateStr,
    to: dateStr,
  })
  .refine((b) => b.from <= b.to, 'from 不可晚於 to');

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());

  const start = new Date(`${b.from}T00:00:00Z`);
  const end = new Date(`${b.to}T00:00:00Z`);
  if ((end.getTime() - start.getTime()) / 86400000 > 366)
    throw new ApiHttpError(400, '區間最長 366 天', ERR.VALIDATION);

  const { data: staffRow, error: eS } = await t.supabase
    .from('staff').select('id').eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
  if (eS) throw eS;
  if (!staffRow) throw new ApiHttpError(404, '找不到此員工', ERR.NOT_FOUND);

  // 取出模式引用到的模板（時間以模板為準），缺一個就 404。
  const templateIds = [...new Set(Object.values(b.weekPattern).filter((x): x is string => !!x))];
  const templates = new Map<string, { start_time: string; end_time: string }>();
  if (templateIds.length > 0) {
    const { data: tplRows, error: eT } = await t.supabase
      .from('shift_templates')
      .select('id, start_time, end_time')
      .eq('tenant_id', t.tenantId)
      .in('id', templateIds);
    if (eT) throw eT;
    if ((tplRows ?? []).length !== templateIds.length)
      throw new ApiHttpError(404, '找不到班別模板', ERR.NOT_FOUND);
    for (const r of tplRows!) templates.set(r.id, r);
  }

  // 展開：weekPattern 有出現的星期 → 該日期列入覆蓋清單；有模板者再產生新班。
  const touchedDates: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = String(d.getUTCDay());
    if (!(key in b.weekPattern)) continue;
    const workDate = d.toISOString().slice(0, 10);
    touchedDates.push(workDate);
    const templateId = b.weekPattern[key];
    if (templateId) {
      const tpl = templates.get(templateId)!;
      rows.push({
        tenant_id: t.tenantId,
        staff_id: b.staffId,
        work_date: workDate,
        template_id: templateId,
        start_time: tpl.start_time,
        end_time: tpl.end_time,
      });
    }
  }

  if (touchedDates.length > 0) {
    const { error: eD } = await t.supabase
      .from('shifts')
      .delete()
      .eq('tenant_id', t.tenantId)
      .eq('staff_id', b.staffId)
      .in('work_date', touchedDates);
    if (eD) throw eD;
  }

  if (rows.length > 0) {
    const { error: eI } = await t.supabase.from('shifts').insert(rows);
    if (eI) throw eI;
  }

  return ok({ inserted: rows.length, clearedDates: touchedDates.length });
});
