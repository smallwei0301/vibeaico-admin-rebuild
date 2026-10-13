'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { publicShopPage as t } from '@/i18n/zh-TW/pages/public-shop';

/** #894：找不到頁面的返回連結導回店家公開首頁；店家本身不存在（已在首頁路徑）時不顯示，避免再 404。 */
export function NotFoundBackLink() {
  const params = useParams<{ shopCode?: string }>();
  const pathname = usePathname();
  const raw = params?.shopCode;
  const shopCode = Array.isArray(raw) ? raw[0] : raw;
  if (!shopCode) return null;
  const shopHref = `/s/${encodeURIComponent(shopCode)}`;
  const current = (pathname ?? '').replace(/\/+$/, '');
  if (current === shopHref || current === `/s/${shopCode}`) return null;
  return (
    <Link href={shopHref} className="btn btn-primary btn-sm w-fit">
      {t.notFound.backToShop}
    </Link>
  );
}
