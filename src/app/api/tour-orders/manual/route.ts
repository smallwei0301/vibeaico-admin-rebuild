import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { taipeiTodayDateString } from '@/server/tz';
import { manualTourOrderSchema } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

/**
 * POST /api/tour-orders/manual — 導遊在後台手動建單（#8-B，10 分冊 §3）。
 *
 * 建單與扣名額**同一交易**，由 `create_tour_order` rpc 負責（10 分冊 §2：
 * 禁止在應用層算庫存）。分成「先 select 剩餘名額、再 insert」兩步的話，兩個
 * 請求同時搶最後一席時兩邊都會讀到 1、兩邊都成功——那就是超賣。
 *
 * 名額不足時 rpc raise `SEATS_UNAVAILABLE`(P0001) → 這裡轉成
 * **409 TOUR_001**（10 分冊 §2 指定的錯誤碼）。
 *
 * order_no：'TO' + yymmdd(Asia/Taipei) + 4 位當日流水（同租戶），與商品訂單
 * 同一套規則。撞 `unique (tenant_id, order_no)` 就重取流水重試最多 3 次。
 */
const MAX_ORDER_NO_ATTEMPTS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (req) => {
  const t = await requireTenantManager();
  // 驗證在閘門之前：格式錯的輸入要回誠實的 400 REQ_001，不是 403 FEAT_001
  // （#8-A 已經為 POST /api/trips 修過一次同型缺陷）。
  const b = manualTourOrderSchema.parse(await req.json());
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: departure, error: depError } = await t.supabase
    .from('trip_departures').select('id, status')
    .eq('tenant_id', t.tenantId).eq('id', b.departureId).maybeSingle();
  if (depError) throw depError;
  if (!departure) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (departure.status !== 'OPEN') {
    return fail(409, '此團次已關閉報名，無法建立訂單', ERR.CONFLICT);
  }

  /**
   * `tenant_payment_methods` 表尚未存在（10 分冊 §4 的設定 UI 讀的是頁內常數），
   * 所以前端送來的會是 mock id。只有真的是 uuid 的值才落庫，其餘存 null——
   * 把 `pm_1` 硬塞進 uuid 欄位會 22P02，而為了它 400 掉整張表單更糟。
   * 收款方式的後端落地後，這個判斷連同註解一起移除。
   */
  const paymentMethodId = b.paymentMethodId && UUID_RE.test(b.paymentMethodId)
    ? b.paymentMethodId : null;

  const yymmdd = taipeiTodayDateString().replaceAll('-', '').slice(2);
  let orderId: string | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ORDER_NO_ATTEMPTS && !orderId; attempt++) {
    const { data: last, error: nError } = await t.supabase
      .from('tour_orders').select('order_no')
      .eq('tenant_id', t.tenantId).like('order_no', `TO${yymmdd}%`)
      .order('order_no', { ascending: false }).limit(1).maybeSingle();
    if (nError) throw nError;
    const serial = last ? Number(String(last.order_no).slice(-4)) + 1 : 1;
    const orderNo = `TO${yymmdd}${String(serial).padStart(4, '0')}`;

    const { data, error } = await t.supabase.rpc('create_tour_order', {
      p_tenant: t.tenantId,
      p_order_no: orderNo,
      p_departure: b.departureId,
      p_party_size: b.partySize,
      p_customer: null,
      p_contact: { name: b.customerName, phone: b.customerPhone },
      p_source: 'MANUAL',
      p_payment_method: paymentMethodId,
      p_note: b.note ?? '',
      // 手動單不自動過期（10 分冊 §3 的表格：LINE／手動單 hold_expires_at = null，
      // 由導遊自己管理）。給它一個到期時間會讓導遊當面收現的單被 cron 取消掉。
      p_hold_expires: null,
    });

    if (!error) { orderId = data as string; break; }

    const message = String((error as any)?.message ?? '');
    // 撞號：重取流水再試。這是唯一該重試的錯誤。
    if ((error as any)?.code === '23505' || message.includes('duplicate key')) {
      lastError = error; continue;
    }
    // 名額不足是 rpc 明確 raise 的業務結果，不是系統錯誤（10 分冊 §2：TOUR_001）
    if (message.includes('SEATS_UNAVAILABLE')) {
      return fail(409, '此團次名額不足，無法建立訂單', ERR.SEATS_UNAVAILABLE);
    }
    if (message.includes('PARTY_SIZE_OUT_OF_RANGE')) {
      return fail(400, '人數不在此方案的成團人數範圍內', ERR.VALIDATION);
    }
    if (message.includes('DEPARTURE_NOT_FOUND') || message.includes('PLAN_NOT_FOUND')) {
      return fail(404, '找不到此團次或方案', ERR.NOT_FOUND);
    }
    throw error;
  }

  if (!orderId) throw lastError ?? new Error('order_no allocation failed');

  const { data: created, error: readError } = await t.supabase
    .from('tour_orders').select('*')
    .eq('tenant_id', t.tenantId).eq('id', orderId).maybeSingle();
  if (readError) throw readError;
  if (!created) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [created]);
  return ok(order);
});
