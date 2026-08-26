import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/trips/[id]/request-midao-listing — 申請 Midao 前台上架 ⚙M。
 * 10 分冊 §5：`NONE / REJECTED → PENDING`。
 *
 * ⚠️ **這支不會通知 Midao。** 10 分冊 §5 寫「並發 `trip.listing_requested`
 * webhook 給 Midao」，但那條 webhook 屬 Phase 10（11 分冊 §4.2 的審核端點也
 * 還不存在），issue #8 的範圍表明文寫「webhook 通知 Midao 屬 Phase 10，
 * 先寫狀態」。所以本支只寫 `midao_listing = 'PENDING'`。
 * 對應的畫面文案必須說「已送出申請」而不是「Midao 已收到」——後者是我們
 * 目前無法得知的事（CLAUDE.md「Never fabricate a known」）。
 *
 * 已經是 PENDING（重複送審）或 LISTED（已經上架了）→ 409，
 * 不是靜默成功：使用者按了按鈕，要知道為什麼沒有變化。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data: trip, error: rerr } = await t.supabase
    .from('trips').select('midao_listing')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  if (trip.midao_listing === 'PENDING')
    return fail(409, '此行程已在審核中，請等待 Midao 回覆', ERR.CONFLICT);
  if (trip.midao_listing === 'LISTED')
    return fail(409, '此行程已在 Midao 前台上架', ERR.CONFLICT);

  const { data, error } = await t.supabase.from('trips')
    .update({
      midao_listing: 'PENDING',
      // 重新送審時清掉上一次的退回原因，否則畫面會一直掛著舊的紅字
      midao_listing_note: '',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  return ok(mapTrip(data));
});
