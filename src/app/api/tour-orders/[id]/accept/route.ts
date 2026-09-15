import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { acceptTourRequestSchema } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/:id/accept — 導遊接受 REQUEST 訂單（#46，GUIDE 側）。
 *
 * 依 `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §0.2 與
 * `docs/decisions/2026-09-14-guide-request-payment-hold.md`：旅客／導遊送出
 * REQUEST 申請時**不鎖名額**（見 `0111` migration 對 `create_tour_order` 的修法
 * ——那是這個切片真正在修的「假成功」：舊行為對所有 sales_mode 一律鎖名額）。
 * 導遊按下「接受」的這一刻，才是「原子重查 availability 並鎖定名額」真正發生
 * 的時間點，且開始跑付款保留期。
 *
 * 全部三件事（重查名額、鎖名額、算 `hold_expires_at`）都在 `accept_tour_request`
 * 一支 rpc 裡、同一個 row lock 下完成（同 `create_tour_order`／`reserve_seats`
 * 的既有慣例：**禁止在應用層算庫存或算期限**）。這裡只做兩件事：翻譯 rpc 的
 * 業務錯誤成 HTTP 語意、讀回更新後的訂單。
 *
 * 錯誤對映：
 *   ORDER_NOT_FOUND（P0002）  → 404
 *   ORDER_NOT_ELIGIBLE（P0010）→ 409 TOUR_002（不是 PENDING 或不是 REQUEST 方案）
 *   SEATS_UNAVAILABLE（P0001） → 409 TOUR_001（重查後名額已被別的案件用掉——
 *     這就是 Issue 文案已經預告的「時段已被其他案件取得」情境）
 */
export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  const body = acceptTourRequestSchema.parse(await req.json().catch(() => ({})));
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: orderId, error } = await t.supabase.rpc('accept_tour_request', {
    p_tenant: t.tenantId,
    p_order: id,
    p_hold_hours: body.holdHours ?? null,
  });

  if (error) {
    const message = String((error as any)?.message ?? '');
    if (message.includes('ORDER_NOT_FOUND')) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
    if (message.includes('ORDER_NOT_ELIGIBLE')) {
      return fail(409, '此訂單目前無法接受申請（非待處理的先申請再確認訂單）', ERR.TOUR_REQUEST_NOT_ELIGIBLE);
    }
    if (message.includes('SEATS_UNAVAILABLE')) {
      return fail(409, '此時段已被其他案件取得，無法接受此申請', ERR.SEATS_UNAVAILABLE);
    }
    throw error;
  }
  if (!orderId) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  const { data: updated, error: readError } = await t.supabase.from('tour_orders')
    .select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!updated) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [updated]);
  return ok(order);
});
