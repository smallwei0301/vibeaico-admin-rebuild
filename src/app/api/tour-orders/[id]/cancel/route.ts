import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { mapTourOrder } from '@/server/mappers';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().optional() }).partial();

/**
 * POST /api/tour-orders/[id]/cancel — 取消訂單並**釋放名額** ⚙M（10 分冊 §3）。
 *
 * 兩件事必須一起發生，順序也不能反：先把訂單標成 CANCELLED（帶
 * `.neq('status','CANCELLED')` 這個條件，所以兩個並發的取消只有一個會拿到
 * 資料列），拿到資料列的那一個才呼叫 `release_seats`。反過來寫（先放名額再
 * 改狀態）會讓重複點擊放兩次名額，團次就會憑空多出可售位子。
 *
 * `release_seats` 已 revoke anon/authenticated（0026），只能用 service role
 * 呼叫——權限在這一層（requireTenant('MANAGER')）已經驗過，與
 * `/api/points/transfer` 的作法一致。
 *
 * 已付款的訂單一樣可以取消（10 分冊 §4：退款一律人工），`payment_status`
 * 保持 PAID 不動——這裡不會自動改成 REFUNDED，因為錢有沒有退回去是我們
 * 無從得知的事。
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  let reason = '';
  try {
    reason = bodySchema.parse(await req.json()).reason ?? '';
  } catch {
    // 沒帶 body（或不是 JSON）視為未填原因；取消原因是選填欄位
  }

  const { data: cur, error: rerr } = await t.supabase
    .from('tour_orders').select('status, departure_id, party_size')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!cur) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  if (cur.status === 'CANCELLED') return fail(409, '此訂單已取消', ERR.CONFLICT);
  if (cur.status === 'COMPLETED') return fail(409, '已結案的訂單無法取消', ERR.CONFLICT);

  const { data, error } = await t.supabase.from('tour_orders')
    .update({
      status: 'CANCELLED',
      cancel_reason: reason,
      hold_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', t.tenantId).eq('id', id).neq('status', 'CANCELLED')
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .maybeSingle();
  if (error) throw error;
  // 沒拿到資料列 = 另一個並發請求先取消了，名額也已經由它釋放
  if (!data) return fail(409, '此訂單已取消', ERR.CONFLICT);

  const admin = createAdminSupabase();
  const { error: rsErr } = await admin.rpc('release_seats', {
    p_departure: cur.departure_id,
    p_count: cur.party_size,
  });
  if (rsErr) throw rsErr;

  return ok(mapTourOrder(data));
});
