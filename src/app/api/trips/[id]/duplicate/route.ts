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

  const { data: src, error: rerr } = await t.supabase
    .from('trips').select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!src) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { id: _id, created_at: _c, updated_at: _u, ...rest } = src as Record<string, any>;

  // slug 在租戶內唯一：先試 `-copy`，撞到就往後補流水號。
  const baseSlug = `${src.slug}-copy`;
  const { data: taken } = await t.supabase
    .from('trips').select('slug').eq('tenant_id', t.tenantId).like('slug', `${baseSlug}%`);
  const used = new Set((taken ?? []).map((r: any) => r.slug));
  let slug = baseSlug;
  for (let n = 2; used.has(slug); n += 1) slug = `${baseSlug}-${n}`;

  const { data: copy, error } = await t.supabase.from('trips').insert({
    ...rest,
    slug,
    title: `${src.title}（複本）`,
    // 複本一律回草稿、且沒有任何 Midao 上架狀態——不能把來源的「已上架」
    // 一起複製過去，那會讓一個從未送審的行程顯示成已在 Midao 前台。
    status: 'DRAFT',
    midao_listing: 'NONE',
    midao_listing_note: '',
  }).select('*').single();
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error) throw error;

  const { data: plans, error: perr } = await t.supabase
    .from('trip_plans').select('*').eq('tenant_id', t.tenantId).eq('trip_id', id);
  if (perr) throw perr;

  if (plans?.length) {
    const rows = plans.map((p: any) => {
      const { id: _pid, created_at: _pc, updated_at: _pu, ...prest } = p;
      return {
        ...prest,
        trip_id: copy.id,
        // 複本的方案還沒被 Midao 看過，審核狀態一律歸零
        review_state: 'NONE',
        review_note: '',
      };
    });
    const { error: pierr } = await t.supabase.from('trip_plans').insert(rows);
    if (pierr) throw pierr;
  }

  const { data: addons, error: aerr } = await t.supabase
    .from('trip_addons').select('*').eq('tenant_id', t.tenantId).eq('trip_id', id);
  if (aerr) throw aerr;

  if (addons?.length) {
    const rows = addons.map((a: any) => {
      const { id: _aid, created_at: _ac, updated_at: _au, ...arest } = a;
      return { ...arest, trip_id: copy.id };
    });
    const { error: aierr } = await t.supabase.from('trip_addons').insert(rows);
    if (aierr) throw aierr;
  }

  const prices = (plans ?? []).filter((p: any) => p.active).map((p: any) => Number(p.base_price));
  return ok(mapTrip(copy, {
    planCount: plans?.length ?? 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    // 團次刻意不複製，所以複本的近期團次真的就是 0
    upcomingDepartureCount: 0,
  }));
});
