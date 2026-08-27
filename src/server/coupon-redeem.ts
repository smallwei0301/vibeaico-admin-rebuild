/**
 * 票券核銷的**唯一一份**實作（issue #33 第 ① 筆）。
 *
 * 在此之前，「查 coupon_instances → 檢查未核銷 → 條件式 update redeemed_at」
 * 這段邏輯有兩份拷貝：`/api/coupons/redeem-by-code` 與
 * `/api/bookings/:id/apply-coupon`。要再補 `/api/product-orders/:id/apply-coupon`
 * 時就會變三份——同一件事多份實作、短期一樣、長期分岔，是本專案反覆抓到的
 * 缺陷家族，所以先把它收成一份，三個呼叫端都改成呼叫這裡。
 *
 * 兩個折抵版本（bookings / product-orders）的**適用規則刻意完全相同**：
 *
 *   ⚠️ 「票券是否適用於商品訂單、有無品類限制」——**原站規格對此零字串**。
 *   `docs/specs/product-orders.json` 的 jsStrings 只有「票券已套用！折抵 …」
 *   「票券已套用，但「完成訂單」失敗：」「請輸入票券代碼」三句，沒有任何一句
 *   提到限制、品類、或不適用。coupons.json 的 formModal 也沒有「適用範圍」欄位。
 *   所以「與預約版同一套規則（不限品類，只限票券持有人本人）」**是我方選的，
 *   不是原站考據的結果**（issue #33 人工介入點的預設值；記於 14 分冊 §15.1
 *   與 04 分冊 §B-4.1）。
 *   日後若擁有者裁決要加品類限制，改這個檔一處即可。
 */
import { ApiHttpError, ERR } from '@/server/http';
import type { requireTenant } from '@/server/tenant';

/** requireTenant() 的回傳（tenant.ts 沒有匯出具名型別，這裡就地推導，不改那個檔） */
type TenantContext = Awaited<ReturnType<typeof requireTenant>>;

export type RedeemedCoupon = {
  instanceId: string;
  couponId: string;
  code: string;
  couponName: string;
  discountType: string;
  discountValue: number;
  /** 票券是發給誰的（coupon_instances.customer_id，not null） */
  customerId: string;
  customerName: string;
};

/**
 * discount 欄位語意（0004 migration：coupons.discount_type / discount_value，
 * enum AMOUNT | PERCENT | GIFT——migration 未再註解，此處決策並固定）：
 *   AMOUNT  折抵固定金額：final = max(0, final - value)
 *   PERCENT 打折（value = 折扣百分比，例 10 = 減 10%）：
 *           final = round(final * (1 - value/100))，round 取整避免小數金額
 *   GIFT    贈品券：不影響金額，只核銷
 * 折扣基底用「目前的應付金額」而非原價：apply-points / adjust-price 可能已先
 * 動過它，用原價重算會把先前的折抵洗掉。
 */
export function applyCouponDiscount(final: number, type: string, value: number): number {
  if (type === 'AMOUNT') return Math.max(0, final - value);
  if (type === 'PERCENT') return Math.max(0, Math.round(final * (1 - value / 100)));
  return final; // GIFT
}

/**
 * 核銷一張票券（依代碼），成功時 `redeemed_at` 已寫入。
 *
 * @param expectCustomerId 給定時，票券必須是發給這位顧客的，否則 409。
 *        （預約／商品訂單兩版都會帶——票券是發給特定顧客的，
 *        不能核銷在別人的單子上。）
 *
 * 錯誤：
 *   404 REQ_002 找不到此票券
 *   409 REQ_003 此票券已核銷
 *   409 REQ_003 此票券已過期
 *   409 REQ_003 此票券不屬於這位顧客（帶 expectCustomerId 時）
 */
export async function redeemCouponByCode(
  t: TenantContext,
  rawCode: string,
  opts: {
    expectCustomerId?: string;
    notOwnerMessage?: string;
    /** 呼叫端的既有文案（redeem-by-code 說的是「核銷代碼」不是「票券」），
     *  只換措辭，不換狀態碼與判斷。 */
    notFoundMessage?: string;
    alreadyRedeemedMessage?: string;
  } = {},
): Promise<RedeemedCoupon> {
  const NOT_FOUND = opts.notFoundMessage ?? '找不到此票券';
  const REDEEMED = opts.alreadyRedeemedMessage ?? '此票券已核銷';
  // 代碼一律大寫英數（batch-issue 產的就是），輸入寬容處理
  const code = rawCode.trim().toUpperCase();

  const { data: inst, error: e0 } = await t.supabase
    .from('coupon_instances')
    // ⚠️ 這個 select 字串要維持成**單一字面量**：拆成 `'a' + 'b'` 會讓
    // supabase-js 的型別推導退化成 GenericStringError，整段就沒有欄位型別了。
    .select('id, coupon_id, customer_id, redeemed_at, coupons(name, discount_type, discount_value, end_at), customers(name)')
    .eq('tenant_id', t.tenantId).eq('code', code)
    .maybeSingle();
  if (e0) throw e0;
  if (!inst) throw new ApiHttpError(404, NOT_FOUND, ERR.NOT_FOUND);
  if (inst.redeemed_at) throw new ApiHttpError(409, REDEEMED, ERR.CONFLICT);

  // 巢狀 join 在無 Database 型別時被靜態推成陣列，實際為多對一物件
  //（同 src/server/email/notify.ts 的說明），先轉 unknown 再取用。
  const nested = inst as unknown as {
    coupons: { name: string; discount_type: string; discount_value: number; end_at: string | null } | null;
    customers: { name: string } | null;
  };
  const coupon = nested.coupons;
  if (!coupon) throw new ApiHttpError(404, NOT_FOUND, ERR.NOT_FOUND);

  // 過期判定只看 coupons.end_at（0004：可為 null＝不限期）。
  // coupon_instances 沒有自己的有效期欄位，所以這裡不會多發明一個。
  if (coupon.end_at && Date.parse(coupon.end_at) < Date.now())
    throw new ApiHttpError(409, '此票券已過期', ERR.CONFLICT);

  if (opts.expectCustomerId && inst.customer_id !== opts.expectCustomerId)
    throw new ApiHttpError(409, opts.notOwnerMessage ?? '此票券不屬於這位顧客', ERR.CONFLICT);

  // 條件式 update（.is redeemed_at null）防止並發重複核銷：
  // 兩個同時進來的請求只有一個會拿到列。
  const { data: updated, error: e1 } = await t.supabase
    .from('coupon_instances')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('id', inst.id).eq('tenant_id', t.tenantId).is('redeemed_at', null)
    .select('id').maybeSingle();
  if (e1) throw e1;
  if (!updated) throw new ApiHttpError(409, REDEEMED, ERR.CONFLICT);

  return {
    instanceId: inst.id,
    couponId: inst.coupon_id,
    code,
    couponName: coupon.name ?? '',
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value ?? 0),
    customerId: inst.customer_id,
    customerName: nested.customers?.name ?? '',
  };
}
