import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * /api/payment-methods — 店家收款方式 CRUD（issue #9 第二步）
 * -----------------------------------------------------------------------------
 * 在這支端點存在之前，`/tenant/payment-methods` 是**整頁假的**：載入讀頁內的
 * `MOCK_METHODS`，新增／編輯／啟停／刪除只改本地 state 再跳成功 toast。而且它
 * 不是 `adapt()` 的 mock 分支，所以正式站上也是那一段——店家看到「已更新」，
 * 重新整理就全部消失。
 *
 * ## ⚠️ 這裡刻意沒有金流閘道欄位
 *
 * 「線上刷卡付款」需要藍新／綠界的商店憑證，那條路徑還沒有任何實作也還沒拿到
 * 憑證（#9 第三步，與 #12／#32 綁定）。所以本端點只處理**五種線下收款**需要的
 * 資料：類型、顯示名稱、QR 圖、銀行欄位、備註、啟停與排序。
 *
 * `ONLINE_PAYMENT` 仍可被建立（店家可以先把它列出來），但沒有任何憑證欄位可存，
 * 頁面會誠實標示尚未開通。**不要**因為「表單上有欄位」就在這裡加 gateway 欄位：
 * 那會讓 schema 看起來像已經接好金流。
 *
 * ## 欄位對應
 *
 * 只有 `BANK_TRANSFER` 用得到銀行四欄，所以它們與備註一起打包進 `config` jsonb，
 * 不逐欄開（理由見 `0094` migration 的註解）。
 *
 *   bankName / bankCode / accountNumber / accountHolderName / instructions → config
 */

import {
  METHOD_LIMIT, PAYMENT_METHOD_COLUMNS, mapPaymentMethod, paymentMethodBodySchema,
} from '@/server/payment-methods';

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('tenant_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  return ok((data ?? []).map(mapPaymentMethod));
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = paymentMethodBodySchema.parse(await req.json());

  const { count, error: e0 } = await t.supabase
    .from('tenant_payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId);
  if (e0) throw e0;
  if ((count ?? 0) >= METHOD_LIMIT)
    throw new ApiHttpError(409, `每店最多 ${METHOD_LIMIT} 種收款方式`, ERR.CONFLICT);

  /*
   * 沒指定排序就接在最後面。
   * ⚠️ 用 `count` 當新的 sort_order 會在刪除後產生重複值（刪掉中間一筆，count 變小，
   * 下一筆就撞上既有的尾端），所以讀的是實際的最大值。
   */
  const { data: last, error: e1 } = await t.supabase
    .from('tenant_payment_methods')
    .select('sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;

  const { data, error } = await t.supabase
    .from('tenant_payment_methods')
    .insert({
      tenant_id: t.tenantId,
      method_type: b.methodType,
      display_name: b.displayName,
      qr_image_url: b.qrImageUrl,
      config: b.config,
      active: b.active,
      sort_order: b.sortOrder ?? Number(last?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id as string });
});
