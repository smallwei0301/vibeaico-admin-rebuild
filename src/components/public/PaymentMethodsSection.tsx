/**
 * 旅客訂單狀態頁的店家收款方式區塊（issue #938）。
 * QR 圖只在 qrImageUrl 為 https:// 時渲染（舊資料可能只存檔名或非 https，不顯示壞圖／混合內容）。
 */
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import type { PublicPaymentMethod } from '@/lib/public-payment-methods';

/** QR 網址：trim 後以 URL parser 解析，只有 https: 才回傳可渲染的網址。 */
export function safeHttpsUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

export function PaymentMethodsSection({ methods }: { methods: PublicPaymentMethod[] }) {
  const pm = t.status.paymentMethods;
  return (
    <section className="card">
      <div className="card-body flex flex-col gap-3">
        <h2 className="text-base font-medium">{pm.title}</h2>
        {methods.length === 0 ? (
          <p className="text-sm text-secondary">{pm.empty}</p>
        ) : (
          <>
            <p className="text-sm text-secondary">{pm.intro}</p>
            <ul className="flex flex-col gap-3">
              {methods.map((m) => {
                const qrUrl = safeHttpsUrl(m.qrImageUrl);
                const bank = [m.bankName, m.bankCode].filter(Boolean).join(' ');
                return (
                  <li key={m.id} className="flex flex-col gap-1 rounded-lg border border-neutral p-3 text-sm">
                    <div className="font-medium">
                      {m.displayName || pm.types[m.methodType]}
                      <span className="ml-2 text-xs text-secondary">{pm.types[m.methodType]}</span>
                    </div>
                    {bank || m.accountNumber || m.accountHolderName ? (
                      <dl className="grid grid-cols-[5rem_1fr] gap-y-1">
                        {bank ? (<><dt className="text-secondary">{pm.fields.bank}</dt><dd className="break-all">{bank}</dd></>) : null}
                        {m.accountNumber ? (<><dt className="text-secondary">{pm.fields.accountNumber}</dt><dd className="break-all">{m.accountNumber}</dd></>) : null}
                        {m.accountHolderName ? (<><dt className="text-secondary">{pm.fields.accountHolder}</dt><dd className="break-all">{m.accountHolderName}</dd></>) : null}
                      </dl>
                    ) : null}
                    {m.instructions ? <p className="whitespace-pre-line text-secondary">{m.instructions}</p> : null}
                    {qrUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrUrl} alt={pm.qrAlt(m.displayName || pm.types[m.methodType])} className="h-40 w-40 max-w-full object-contain" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {methods.some((m) => m.methodType === 'BANK_TRANSFER') ? (
              <p className="text-sm text-secondary">{pm.afterTransferNote}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
