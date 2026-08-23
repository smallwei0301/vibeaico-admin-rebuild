// GET /api/block-times?from&to、POST /api/block-times — 封鎖時段 CRUD（04 §B-1，
// 欄位同 0004 migration 的 block_times：staff_id null = 全店）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const createSchema = z.object({
  /** 省略或 null = 全店封鎖 */
  staffId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1, '請輸入開始時間'),
  endAt: z.string().min(1, '請輸入結束時間'),
  reason: z.string().optional(),
});

/** block_times 沒有前端契約型別（types.ts 只准新增 CalendarEvent），照 mappers.ts 慣例就地轉 camelCase */
function mapBlockTime(r: any) {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff?.name ?? null, // 巢狀 join 實際為多對一物件（同 notify.ts 說明）
    startAt: r.start_at,
    endAt: r.end_at,
    reason: r.reason ?? '',
    createdAt: r.created_at,
  };
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  let query = t.supabase.from('block_times')
    .select('id, staff_id, start_at, end_at, reason, created_at, staff(name)')
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: true });
  // 區間給了才過濾；重疊判定（start < to 且 end > from）跨界事件不漏
  if (q.to) query = query.lt('start_at', q.to);
  if (q.from) query = query.gt('end_at', q.from);

  const { data, error } = await query;
  if (error) throw error;
  return ok((data ?? []).map(mapBlockTime));
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = createSchema.parse(await req.json());

  const startMs = Date.parse(b.startAt);
  const endMs = Date.parse(b.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
    throw new ApiHttpError(400, '時間區間格式錯誤（結束需晚於開始）', ERR.VALIDATION);

  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  const { data, error } = await t.supabase.from('block_times')
    .insert({
      tenant_id: t.tenantId,
      staff_id: b.staffId ?? null,
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
      reason: b.reason ?? '',
    })
    .select('id').single();
  if (error) throw error;
  return ok({ id: data.id });
});
