import type { ReactNode } from 'react';
import type { PublicShop } from '@/server/public-shop';
import { phoneContact } from '@/lib/public-phone';

type PublicContactLabels = {
  viaLine: string;
  viaPhone: (phone: string) => string;
  viaEmail: (email: string) => string;
  noContact: string;
};

export function PublicContactActions({
  shop,
  labels,
}: {
  shop: PublicShop;
  labels: PublicContactLabels;
}) {
  const actions: ReactNode[] = [];
  if (shop.lineBasicId) {
    actions.push(
      <a
        key="line"
        className="btn btn-primary"
        href={`https://line.me/R/ti/p/${encodeURIComponent(shop.lineBasicId)}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {labels.viaLine}
      </a>,
    );
  }
  const phone = phoneContact(shop);
  if (phone.kind === 'link') {
    actions.push(
      <a key="phone" className="btn btn-outline" href={`tel:${phone.href}`}>
        {labels.viaPhone(shop.phone)}
      </a>,
    );
  } else if (phone.kind === 'text') {
    // 不可撥號（例如含分機）：只顯示純文字，不提供撥號按鈕。
    actions.push(<span key="phone-text" className="text-sm text-secondary">{shop.phone}</span>);
  }
  if (shop.email) {
    actions.push(
      <a key="email" className="btn btn-outline" href={`mailto:${shop.email}`}>
        {labels.viaEmail(shop.email)}
      </a>,
    );
  }

  return actions.length ? (
    <div className="flex flex-wrap gap-2">{actions}</div>
  ) : (
    <p className="text-sm text-secondary">{labels.noContact}</p>
  );
}
