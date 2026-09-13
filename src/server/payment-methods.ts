/**
 * src/server/payment-methods.ts — 收款方式端點的共用 schema 與欄位對映（issue #9）
 *
 * ⚠️ 這些東西不能放在 `route.ts` 裡再 export：Next.js App Router 的 route 檔只允許
 * 匯出 HTTP handler 與少數設定欄位，多匯出一個 `mapPaymentMethod` 就會讓
 * `npm run build` 直接失敗（`"mapPaymentMethod" is not a valid Route export field`）。
 * 本輪實際踩到過。
 */
import { z } from 'zod';

/** 與 `0094` 的 `payment_method_type` 列舉逐字相同 */
const METHOD_TYPES = [
  'LINE_PAY', 'JKOPAY', 'BANK_TRANSFER', 'CASH', 'ONLINE_PAYMENT', 'OTHER',
] as const;

/** 每店的收款方式上限。原站沒有明文上限，這裡取一個明顯夠用又擋得住失控的值。 */
export const METHOD_LIMIT = 30;

const configSchema = z.object({
  bankName: z.string().max(100).optional(),
  bankCode: z.string().max(20).optional(),
  accountNumber: z.string().max(50).optional(),
  accountHolderName: z.string().max(100).optional(),
  instructions: z.string().max(1000).optional(),
}).strict();

export const paymentMethodBodySchema = z.object({
  methodType: z.enum(METHOD_TYPES),
  displayName: z.string().min(1, '請輸入顯示名稱').max(100),
  qrImageUrl: z.string().max(500).default(''),
  config: configSchema.default({}),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export function mapPaymentMethod(r: Record<string, unknown>) {
  const config = (r.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: r.id as string,
    methodType: r.method_type as string,
    displayName: (r.display_name as string) ?? '',
    qrImageUrl: (r.qr_image_url as string) ?? '',
    bankName: str(config.bankName),
    bankCode: str(config.bankCode),
    accountNumber: str(config.accountNumber),
    accountHolderName: str(config.accountHolderName),
    instructions: str(config.instructions),
    active: !!r.active,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

/** 端點只回這些欄位——`select('*')` 會把日後任何新欄位（含祕密）自動吐出去。 */
export const PAYMENT_METHOD_COLUMNS = 'id, method_type, display_name, qr_image_url, config, active, sort_order, created_at';

