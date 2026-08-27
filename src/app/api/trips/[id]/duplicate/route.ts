import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/trips/[id]/duplicate — 複製行程 ⚙M。
 *
 * ⚠️ **10 分冊沒有這一支**，issue #8 把「行程『複製』功能（前端有按鈕、無規格）」
 * 列在人工介入點裡等擁有者裁決（做，或移除按鈕）。這裡選擇「做」，理由與
 * 依據：
 *   1. 擁有者的標準方針是**補齊優先於刪除**（15 分冊「誠實化之前，先查這個
 *      功能有沒有既有裁決」一節）。
 *   2. 語意不是發明出來的：`/tenant/trips` 頁的 `duplicate()` 已經明確定義了
 *      複本長什麼樣（標題加「（複本）」、slug 加 `-copy`、status 回 DRAFT、
 *      midaoListing 回 NONE），這一支只是把那段本地假成功搬到後端做真的。
 *   3. `POST /api/services/:id/duplicate` 是同型的既有先例。
 * 擁有者若裁決「移除按鈕」，刪掉這一支與列表頁那顆鈕即可。
 *
 * 複製範圍：行程本體 + 方案 + 加購。**團次不複製**——團次是「某年某月某日
 * 出團」的具體排程與名額，複製一份到新行程只會產生一批沒人要的日期
 * （10 分冊 §5.5：只有「有日期」的東西上行事曆，複製日期等於複製行事曆事件）。
 * 訂單當然也不複製。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  // One SECURITY INVOKER RPC owns source authorization, the source-row lock,
  // slug allocation, and all writes in a single database transaction.
  const { data, error } = await t.supabase.rpc('duplicate_trip_atomic', {
    p_tenant_id: t.tenantId,
    p_source_trip_id: id,
  });
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error?.code === '42501') return fail(403, '權限不足', ERR.FORBIDDEN);
  if (error) throw error;
  const result = data as {
    trip?: Record<string, unknown>;
    plan_count?: number;
    min_price?: number;
    upcoming_departure_count?: number;
  } | null;
  const copy = result?.trip;
  if (!copy) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  return ok(mapTrip(copy, {
    planCount: Number(result.plan_count ?? 0),
    minPrice: Number(result.min_price ?? 0),
    upcomingDepartureCount: Number(result.upcoming_departure_count ?? 0),
  }));
});
