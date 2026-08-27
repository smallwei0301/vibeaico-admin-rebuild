import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { mapTourOrder } from '@/server/mappers';

/**
 * POST /api/tour-orders/manual — 導遊代旅客下單（10 分冊 §5）⚙M。
 *
 * 建單與扣名額由 rpc `create_tour_order` 在**同一個交易**完成
 * （10 分冊 §2 規約，migration 0026）。金額不接受前端送來的值——
 * 一律由 rpc 依 `trip_plans` 的現值計算（單價、每人/每團、定金模式），
 * 否則後台就能把總額打成任意數字。
 *
 * 名額不足 → 409 `TOUR_001`（10 分冊 §2 指定的錯誤碼）。
 *
 * `paymentMethodId` 目前**只是原樣存下**，不做任何驗證：
 * `tenant_payment_methods` 屬 10 分冊 §4（Phase 8c / issue #9），現在沒有這張
 * 表可以查，所以也拿不到收款方式的顯示名稱（見 `mapTourOrder` 的註解）。
 *
 * `holdExpiresAt` 不設：10 分冊 §3 的表格寫明「LINE / 手動單 → null（導遊
 * 自己管理），不自動過期」。
 */
const bodySchema = z.object({
  departureId: z.string().uuid('請選擇團次'),
  customerName: z.string().min(1, '請輸入旅客姓名'),
  customerPhone: z.string().min(1, '請輸入聯絡電話'),
  partySize: z.number().int('人數必須為整數').min(1, '人數必須大於 0'),
  paymentMethodId: z.string().uuid().optional(),
  note: z.string().optional(),
  source: z.enum(['MANUAL', 'LINE']).optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { data: newId, error } = await admin.rpc('create_tour_order', {
    p_tenant: t.tenantId,
    p_departure: b.departureId,
    p_party: b.partySize,
    p_customer_name: b.customerName,
    p_customer_phone: b.customerPhone,
    p_source: b.source ?? 'MANUAL',
    p_note: b.note ?? '',
    p_payment_method: b.paymentMethodId ?? null,
    p_customer: null,
    p_hold_expires: null,
  });

  if (error) {
    // rpc 內 raise exception 的訊息 → HTTP 錯誤映射（0012/0026 的既有慣例）
    const msg = error.message ?? '';
    if (msg.includes('SEATS_UNAVAILABLE'))
      return fail(409, '此團次名額不足', 'TOUR_001');
    if (msg.includes('DEPARTURE_NOT_FOUND'))
      return fail(404, '找不到此團次', ERR.NOT_FOUND);
    if (msg.includes('PLAN_NOT_FOUND'))
      return fail(404, '找不到此團次的方案', ERR.NOT_FOUND);
    if (msg.includes('PARTY_OVER_MAX'))
      return fail(409, '人數超過此方案的單筆上限', ERR.CONFLICT);
    if (msg.includes('PARTY_INVALID'))
      return fail(400, '人數必須大於 0', ERR.VALIDATION);
    throw error;
  }

  const { data, error: readErr } = await t.supabase
    .from('tour_orders')
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .eq('tenant_id', t.tenantId).eq('id', newId as string).maybeSingle();
  if (readErr) throw readErr;
  if (!data) return fail(500, '訂單建立後讀取失敗', ERR.INTERNAL);

  return ok(mapTourOrder(data));
});
