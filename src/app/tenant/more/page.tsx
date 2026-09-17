'use client';
import * as React from 'react';
import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { getGuideMoreGroups } from '@/config/nav';
import { navLabel, type NavKey } from '@/i18n/zh-TW/nav';
import { morePage as t } from '@/i18n/zh-TW/pages/more';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';

/**
 * GUIDE 手機五大父層級之「更多」（`docs/integration/20-GUIDE-RESPONSIVE-UI.md` §7）。
 *
 * 本頁只把既有 `src/config/nav.ts` 的葉節點依 `GUIDE_MORE_GROUPS` 分組顯示，
 * 每個項目都是既有 route 的直接連結（見「明確禁止」章節：不另建第二套資料模型）。
 * Feature 訂閱狀態的引導（未訂閱 → 導到功能商店）由各目的頁自己既有的邏輯負責，
 * 本頁不重複那套判斷。
 */
export default function MorePage() {
  const businessType = useBusinessType();
  const { extraModules } = useCurrentTenant();

  const groups = React.useMemo(
    () => getGuideMoreGroups(businessType, extraModules),
    [businessType, extraModules],
  );

  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {groups.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t.empty.title} description={t.empty.description} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle>{t.groups[group.key as keyof typeof t.groups] ?? group.key}</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <ul>
                  {group.leaves.map((leaf) => {
                    const Icon = leaf.icon;
                    return (
                      <li key={leaf.key}>
                        <Link
                          href={leaf.href}
                          className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3 text-sm text-dark first:border-t-0 hover:bg-neutral-50"
                        >
                          <Icon size={18} className="flex-shrink-0 text-secondary" />
                          <span className="truncate">{navLabel(leaf.key as NavKey, businessType)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
