/**
 * src/server/public-payment-methods.ts — 旅客訂單狀態頁的店家收款方式（issue #938，只讀）
 * ⚠️ 呼叫者必須先通過 `loadPublicTourRequestStatus` 的存取驗證（shopCode + orderId + contact）
 * 才能呼叫本函式；本函式本身不驗證旅客身分，只依 shopCode 反查 tenant。
 * 只回白名單欄位（0094 的 config 不含金流憑證，但仍不信任額外 key）。
 */
import { createAdminSupabase } from '@/server/supabase';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import type { PublicPaymentMethod, PublicPaymentMethodType } from '@/lib/public-payment-methods';

const TYPES: readonly string[] = ['LINE_PAY', 'JKOPAY', 'BANK_TRANSFER', 'CASH', 'ONLINE_PAYMENT', 'OTHER'];

export function toPublicPaymentMethod(r: Record<string, unknown>): PublicPaymentMethod | null {
  if (typeof r.method_type !== 'string' || !TYPES.includes(r.method_type)) return null;
  const cfg = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: str(r.id),
    methodType: r.method_type as PublicPaymentMethodType,
    displayName: str(r.display_name),
    qrImageUrl: str(r.qr_image_url),
    bankName: str(cfg.bankName),
    bankCode: str(cfg.bankCode),
    accountNumber: str(cfg.accountNumber),
    accountHolderName: str(cfg.accountHolderName),
    instructions: str(cfg.instructions),
  };
}

export async function loadPublicPaymentMethods(shopCode: string): Promise<PublicPaymentMethod[]> {
  if (!SHOP_CODE_PATTERN.test(shopCode)) return [];
  const admin = createAdminSupabase();
  const { data: tenant, error: tErr } = await admin
    .from('tenants').select('id').eq('shop_code', shopCode).maybeSingle();
  if (tErr) throw new Error(`tenants 查詢失敗：${tErr.message}`);
  if (!tenant) return [];
  const { data, error } = await admin
    .from('tenant_payment_methods')
    .select('id, method_type, display_name, qr_image_url, config, sort_order, created_at')
    .eq('tenant_id', tenant.id as string).eq('active', true)
    // ONLINE_PAYMENT 尚未開通、無付款入口（0094／api/payment-methods），不列入公開清單。
    .neq('method_type', 'ONLINE_PAYMENT')
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw new Error(`tenant_payment_methods 查詢失敗：${error.message}`);
  return (data ?? [])
    .map((r) => toPublicPaymentMethod(r as Record<string, unknown>))
    .filter((m): m is PublicPaymentMethod => m !== null && m.methodType !== 'ONLINE_PAYMENT'); // 與 .neq 雙保險
}
