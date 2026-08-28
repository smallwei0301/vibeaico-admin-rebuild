/**
 * GET / POST `/api/bookings/:id/addons` — 預約加購明細（04 分冊 §B-1.1，issue #17）。
 *
 * 原站端點事實依據：docs/specs/bookings.json 的 jsApiCalls
 * `/api/bookings/${b.id}/addons`（讀）與 `/api/bookings/${addonBookingId}/addons`（寫）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 金額語意：「回沖」是什麼意思（同 DELETE 路由，兩邊都讀得到這段）
 * ─────────────────────────────────────────────────────────────────────────
 * `bookings.final_price` 在本專案是一個**流水餘額**，不是由組成項推導出來的：
 *   - `adjust-price` 直接絕對覆寫（不留任何被覆寫掉的紀錄）
 *   - `apply-coupon` / `apply-points` 都以「目前的 final_price」為基底加減
 *     （見 apply-coupon/route.ts 註解：用原價重算會把先前的折抵洗掉）
 * 所以刪除加購時**無法重算**，只能回沖。本專案把「回沖」定義為：
 *
 *   → **精確反向掉當初那一次異動**：減去 `booking_addons.applied_amount`
 *     （建立當下真的加進去的那個數字，存在該列上），下限 0。
 *
 * 為什麼是「存下來的數字」而不是刪除時重算 price × quantity：兩者今天相等，
 * 但只要日後開放編輯加購、或計價規則變動，重算值就會跟當初實際加上去的量分岔，
 * 於是回沖會多減或少減。存下來的話，回沖永遠是那一次異動的反向操作。
 *
 * 已知**不精確**的兩種互動（誠實記錄，不假裝沒有；04 §B-1.1 同步記載）：
 *   1. 加購之後又套用 **PERCENT 票券**：券打的折連加購金額一起打了，回沖卻減
 *      全額 → 會多減。例：1000＋加購200＝1200，九折→1080，刪加購→880
 *      （精確值應為 900）。
 *   2. 加購之後又**手動調價**：調價是絕對覆寫，回沖等於「假設店家輸入的總價
 *      包含這筆加購的全額」。
 * 兩者都無法從資料判定（adjust-price 不留紀錄、票券折抵不分攤到明細），所以
 * **不猜**：刪除確認視窗直接把「將扣回多少錢」這個數字寫給店家看，看到不對就
 * 自己再調一次價。這是刻意選的處理方式，不是疏漏。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 員工業績：C+ 明確歸戶
 * ─────────────────────────────────────────────────────────────────────────
 * `PRIMARY` 繼承本預約服務人員、`SPECIFIC_STAFF` 歸指定人、`NONE` 只算店家。
 * null 不再同時表示「繼承」與「不計個人業績」。
 */
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { notifyBookingAddonReceipt } from '@/server/booking-addon-notify';
import { mapBookingAddon } from '@/server/mappers';
import type { BookingAddonNotifyOutcome } from '@/lib/types';

/** 可加購的預約狀態：加購會動到金額與時段，只在「還沒結案」的預約上開放 */
const EDITABLE_STATUSES = ['PENDING', 'CONFIRMED'];

const SELECT = 'id, service_id, name, price, quantity, duration_minutes, staff_id, performance_mode, performance_staff_id, ' +
  'applied_amount, applied_minutes, notified, created_at, staff(name)';

/* ------------------------------------------------------------------- GET */

export const GET = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  // 預約本身必須屬於本店：否則「查別店預約的加購」會靜靜回空陣列而不是 404
  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  const { data, error } = await t.supabase.from('booking_addons')
    .select(SELECT)
    .eq('tenant_id', t.tenantId).eq('booking_id', id)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return ok((data ?? []).map((r) => mapBookingAddon(r)));
});

/* ------------------------------------------------------------------ POST */

const bodySchema = z.object({
  /** 「從服務清單帶入」的來源服務；自由輸入（耗材／商品類）省略或 null */
  serviceId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, '請輸入項目名稱'),
  // 0 元允許（贈送／招待的加購項目要記得下來，只是不加錢）；負數才是輸入錯誤。
  // 04 §B-1.1 記載此判讀，邊界兩側都有整合測試。
  price: z.number().min(0, '加購價不可為負'),
  quantity: z.number().int().min(1, '數量至少為 1'),
  durationMinutes: z.number().int().min(0, '佔用時長不可為負').default(0),
  /** 執行人員；省略或 null = 同本預約的人員 */
  staffId: z.string().uuid().nullable().optional(),
  performanceMode: z.enum(['PRIMARY', 'SPECIFIC_STAFF', 'NONE']).default('PRIMARY'),
  performanceStaffId: z.string().uuid().nullable().optional(),
  /** 原站 addonNotify：勾了才推 LINE 消費明細 */
  notify: z.boolean().default(false),
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data: booking, error: bErr } = await t.supabase.from('bookings')
    .select('id, status, final_price, duration_minutes, start_at, end_at')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  if (!EDITABLE_STATUSES.includes(booking.status))
    throw new ApiHttpError(409, '已結案的預約不能再加購', ERR.CONFLICT);

  // 04 §0 第 7 條：帶到別店的 id 一律 404（FK 擋不住「指到別店資源」）
  if (b.serviceId) {
    const { data: s, error } = await t.supabase.from('services').select('id')
      .eq('id', b.serviceId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!s) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);
  }
  if (b.staffId) {
    const { data: s, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!s) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }
  if (b.performanceMode === 'SPECIFIC_STAFF' && !b.performanceStaffId)
    throw new ApiHttpError(400, '請選擇業績歸屬人員', ERR.VALIDATION);
  if (b.performanceStaffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.performanceStaffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到業績歸屬人員', ERR.NOT_FOUND);
  }

  const appliedAmount = b.price * b.quantity;
  const appliedMinutes = b.durationMinutes * b.quantity;

  // ① 先寫明細列（applied_* 記下這一次真的要加多少，回沖時原數減回）
  const { data: addon, error: iErr } = await t.supabase.from('booking_addons')
    .insert({
      tenant_id: t.tenantId,
      booking_id: id,
      service_id: b.serviceId ?? null,
      name: b.name.trim(),
      price: b.price,
      quantity: b.quantity,
      duration_minutes: b.durationMinutes,
      staff_id: b.staffId ?? null,
      performance_mode: b.performanceMode,
      performance_staff_id: b.performanceMode === 'SPECIFIC_STAFF' ? b.performanceStaffId : null,
      applied_amount: appliedAmount,
      applied_minutes: appliedMinutes,
    })
    .select(SELECT).single();
  if (iErr) throw iErr;
  // 巢狀 join（staff(name)）讓 supabase-js 在無 Database 型別時把 data 推成
  // GenericStringError；實際是資料列（同 apply-coupon/route.ts 的 unknown 轉型）。
  const addonRow = addon as unknown as { id: string };

  // ② 把金額與時長加到預約上。
  // CAS（比照 apply-points 的 compare-and-swap）：條件帶讀到的舊 final_price／
  // end_at，兩個併發加購只有一個會匹配成功，另一個重讀新值再試。單純
  // 「final_price + x」的讀改寫會 lost update（兩邊都讀到 1000、各加 200、
  // 最後只有 1200）。
  let applied: { finalPrice: number; endAt: string; durationMinutes: number } | null = null;
  let prev = {
    final_price: Number(booking.final_price),
    end_at: booking.end_at as string,
    duration_minutes: Number(booking.duration_minutes),
  };
  for (let attempt = 0; ; attempt++) {
    const nextEnd = appliedMinutes > 0
      ? new Date(Date.parse(prev.end_at) + appliedMinutes * 60_000).toISOString()
      : prev.end_at;
    const next = {
      final_price: prev.final_price + appliedAmount,
      end_at: nextEnd,
      duration_minutes: prev.duration_minutes + appliedMinutes,
    };
    const { data: updated, error: uErr } = await t.supabase.from('bookings')
      .update(next)
      .eq('id', id).eq('tenant_id', t.tenantId)
      .eq('final_price', prev.final_price).eq('end_at', prev.end_at)   // CAS
      .select('final_price, end_at, duration_minutes').maybeSingle();

    if (uErr) {
      // 佔時間的加購把結束時間往後推，可能撞到同一位員工的下一筆預約
      // （DB 排除約束 x_bookings_overlap）→ 業務衝突，明細列要一起收回。
      await t.supabase.from('booking_addons').delete()
        .eq('id', addonRow.id).eq('tenant_id', t.tenantId);
      if (uErr.code === '23P01')
        throw new ApiHttpError(409, '加購時長會與下一筆預約重疊，請先調整時段', ERR.CONFLICT);
      throw uErr;
    }
    if (updated) {
      applied = {
        finalPrice: Number(updated.final_price),
        endAt: updated.end_at as string,
        durationMinutes: Number(updated.duration_minutes),
      };
      break;
    }
    if (attempt >= 2) {
      await t.supabase.from('booking_addons').delete()
        .eq('id', addonRow.id).eq('tenant_id', t.tenantId);
      throw new ApiHttpError(409, '預約金額異動頻繁，請重試', ERR.CONFLICT);
    }
    const { data: reread, error: rErr } = await t.supabase.from('bookings')
      .select('final_price, end_at, duration_minutes')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (rErr) throw rErr;
    if (!reread) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
    prev = {
      final_price: Number(reread.final_price),
      end_at: reread.end_at as string,
      duration_minutes: Number(reread.duration_minutes),
    };
  }

  // ③ 消費明細通知（勾了才送）。await：店家要在畫面上讀到**實際**結果，
  // 不是一句寫死的「已通知顧客」（00 鐵則 12）。函式永不拋錯。
  let notified: BookingAddonNotifyOutcome = 'NONE';
  if (b.notify) {
    notified = await notifyBookingAddonReceipt(t.tenantId, {
      bookingId: id,
      item: { name: b.name.trim(), quantity: b.quantity, price: b.price },
      addonTotal: appliedAmount,
      bookingTotal: applied.finalPrice,
    });
    await t.supabase.from('booking_addons')
      .update({ notified }).eq('id', addonRow.id).eq('tenant_id', t.tenantId);
  }

  const result = {
    ...mapBookingAddon(addon),
    notified,
  };

  // 額度用完 → 409（issue #17 驗收明列，比照 /api/chat/messages）。
  // ⚠️ **加購本身已經寫入且金額已生效**，不回滾——訊息必須把這件事說清楚，
  // 否則店家會以為整筆加購失敗而重加一次。
  if (notified === 'QUOTA_EXCEEDED')
    throw new ApiHttpError(
      409, '加購已新增，但本月推播額度已用完，未送出消費明細', ERR.CONFLICT);

  return ok({
    addon: result,
    finalPrice: applied.finalPrice,
    endAt: applied.endAt,
    durationMinutes: applied.durationMinutes,
    notified,
  });
});
