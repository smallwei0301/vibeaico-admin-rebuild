// GET /api/block-times?from&to、POST /api/block-times — 封鎖時段 CRUD（04 §B-1）。
//
// 欄位同 block_times（0004 + migration 0027）：staff_id null = 全店；
// recurrence 'SINGLE' | 'WEEKLY'；auto = 由「每天不同營業時間」自動產生
// （issue #33 ②，不可編輯／刪除）。
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
  title: z.string().optional(),
  recurrence: z.enum(['SINGLE', 'WEEKLY']).optional(),
  /** WEEKLY 必填；0 = 週日（同原站 btDayOfWeek 的 option value） */
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  fullDay: z.boolean().optional(),
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
    // migration 0027
    title: r.title ?? '',
    recurrence: (r.recurrence ?? 'SINGLE') as 'SINGLE' | 'WEEKLY',
    dayOfWeek: r.day_of_week ?? null,
    fullDay: !!r.full_day,
    auto: !!r.auto,
  };
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data, error } = await t.supabase.from('block_times')
    .select('id, staff_id, start_at, end_at, reason, created_at, title, recurrence, day_of_week, full_day, auto, staff(name)')
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: true });
  if (error) throw error;

  /*
   * 區間過濾改在應用層做（原本是 SQL 的 .lt/.gt）：WEEKLY 的列存的是**參考週**
   * 的起訖時間（見 src/server/business-hours-blocks.ts），拿它去比對呼叫端的
   * 日期區間會把每一筆每週封鎖都濾掉——那正是「一列＝一整條每週封鎖」這個
   * 模型的代價。所以 WEEKLY 一律回，SINGLE 才套區間。
   * 店家量級小：一次查回不分頁（同其他列表端點的口徑）。
   */
  const rows = (data ?? []).filter((r: any) => {
    if ((r.recurrence ?? 'SINGLE') === 'WEEKLY') return true;
    if (q.to && !(r.start_at < q.to)) return false;
    if (q.from && !(r.end_at > q.from)) return false;
    return true;
  });
  return ok(rows.map(mapBlockTime));
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = createSchema.parse(await req.json());

  const startMs = Date.parse(b.startAt);
  const endMs = Date.parse(b.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
    throw new ApiHttpError(400, '時間區間格式錯誤（結束需晚於開始）', ERR.VALIDATION);

  const recurrence = b.recurrence ?? 'SINGLE';
  // WEEKLY 沒有 dayOfWeek 就沒有「每週的哪一天」可言——與其猜一個（例如拿
  // startAt 的星期幾），不如擋下來，因為猜錯不會有任何紅燈。
  if (recurrence === 'WEEKLY' && (b.dayOfWeek == null))
    throw new ApiHttpError(400, '每週封鎖需指定星期幾', ERR.VALIDATION);

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
      title: b.title ?? '',
      recurrence,
      day_of_week: recurrence === 'WEEKLY' ? b.dayOfWeek : null,
      full_day: b.fullDay ?? false,
      // auto 只由 PUT /api/settings 的重建流程寫入，**不接受呼叫端指定**：
      // 讓外部能把自己的封鎖標成 auto，等於讓它變成不可刪除又會被下次重建
      // 清掉的孤兒列。
      auto: false,
    })
    .select('id').single();
  if (error) throw error;
  return ok({ id: data.id });
});
