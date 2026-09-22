'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * issue #650：匿名「輸入聯絡方式 → 批次查訂單」已停用。
 *
 * 保留既有 component 名稱與 props，是為了不讓 page route 需要一起改形狀；但這裡
 * 不再收集、傳送或比對電話／LINE ID／Email。正式正向路徑由 #12 的 traveler
 * identity + /api/public/me/orders 接手。
 */
export function MyOrdersSearch({
  shopCode,
}: {
  shopCode: string;
  initialContact?: string;
}) {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t.myOrders.title}</h1>
        <p className="text-sm text-secondary">{t.myOrders.description}</p>
      </header>

      <EmptyState
        icon={ShieldCheck}
        title={t.myOrders.initialTitle}
        description={t.myOrders.initialDescription}
      />

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.myOrders.backToShop}
      </Link>
    </>
  );
}
