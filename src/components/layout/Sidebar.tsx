'use client';
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { getNav, isGroup, findActiveGroup, type NavLeaf } from '@/config/nav';
import { navLabel, type NavKey } from '@/i18n/zh-TW/nav';
import type { BusinessType } from '@/config/modes';
import { common } from '@/i18n/zh-TW/common';
import { CountBadge, CountBadgeLoading } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

/**
 * 徽章數字。三種狀態必須分得開（issue #34）：
 *   · `counts` 為 `null`      → **還在查**，放「…」占位，不可先畫 0
 *   · `counts[key]` 有數字    → 查到了，>0 才畫紅點（0 就是沒有待處理）
 *   · `counts[key]` 不存在    → **查不到**（該徽章沒有資料來源，或這次查詢失敗）
 *                               ——什麼都不畫，也不冒充 0
 */
type Counts = Record<string, number>;

/**
 * 側邊欄 — 1:1 對應原站 #sidebar。
 * 保留的關鍵設計決策：
 *  · 當前頁是唯一帶彩度的導航狀態（主色底 + 左側指示條）。原本 active/hover/群組展開
 *    三層白霧亮度接近，店家要盯著看才知道自己在哪一頁。
 *  · 群組手風琴：同時只展開一組（原站 data-bs-parent 行為）。
 *  · 收合模式只留 icon，寬度 250px → 80px。
 */
export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  counts = null,
  businessType = 'LOCAL_SHOP',
  extraModules,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** `null` = 尚未載入完成（見上方 Counts 的三態說明） */
  counts?: Counts | null;
  /** 業態模式決定選單佈局與名詞（見 src/config/modes.ts） */
  businessType?: BusinessType;
  extraModules?: readonly BusinessType[];
}) {
  const pathname = usePathname();
  const entries = React.useMemo(
    () => getNav(businessType, extraModules),
    [businessType, extraModules],
  );
  const [openGroup, setOpenGroup] = React.useState<string | null>(() => findActiveGroup(pathname));

  React.useEffect(() => {
    setOpenGroup(findActiveGroup(pathname));
  }, [pathname]);

  const isActive = (href: string) => href !== '#' && pathname.startsWith(href);

  /** 徽章數字尚未查回來（real 模式的第一個 render 到 API 回應之間） */
  const countsLoading = counts === null;

  const renderLeaf = (leaf: NavLeaf, sub = false) => {
    const Icon = leaf.icon;
    const count = leaf.badge ? counts?.[leaf.badge] ?? 0 : 0;
    return (
      <li key={leaf.key}>
        <Link
          href={leaf.href}
          onClick={onCloseMobile}
          data-active={isActive(leaf.href)}
          className={cn('sidebar-link', sub && 'sidebar-sub-link')}
          title={collapsed ? navLabel(leaf.key as NavKey, businessType) : undefined}
        >
          <Icon size={sub ? 15 : 17} className="flex-shrink-0" />
          <span className="sidebar-link-label truncate">
            {navLabel(leaf.key as NavKey, businessType)}
          </span>
          {leaf.badge && countsLoading
            ? <CountBadgeLoading label={common.badgeLoading} className="ml-auto" />
            : count > 0 && <CountBadge count={count} className="ml-auto" />}
        </Link>
      </li>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-backdrop bg-black/50 lg:hidden" onClick={onCloseMobile} />
      )}
      <nav
        id="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'sidebar',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-modal max-lg:transition-transform',
          mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )}
      >
        <Link className="sidebar-brand" href="/tenant/dashboard">
          <Image src="/images/vibeai-logo.png" alt={common.brand} width={72} height={24}
                 className="h-6 w-auto flex-shrink-0 object-contain" unoptimized />
          <span className="sidebar-brand-text">{common.brand}</span>
        </Link>

        <hr className="sidebar-divider" />

        <ul className="block pb-6">
          {entries.map((entry) => {
            if (!isGroup(entry)) return renderLeaf(entry);

            const Icon = entry.icon;
            const open = openGroup === entry.key;
            const hasActive = entry.children.some((c) => isActive(c.href));
            const groupHasBadge = entry.children.some((c) => Boolean(c.badge));
            const groupCount = entry.children.reduce(
              (sum, c) => sum + (c.badge ? counts?.[c.badge] ?? 0 : 0),
              0,
            );

            return (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-expanded={open}
                  data-has-active={hasActive && !open}
                  className="sidebar-link w-[calc(100%-1rem)]"
                  onClick={() => setOpenGroup(open ? null : entry.key)}
                >
                  <Icon size={17} className="flex-shrink-0" />
                  <span className="sidebar-link-label truncate">
                    {navLabel(entry.key as NavKey, businessType)}
                  </span>
                  {groupHasBadge && countsLoading
                    ? <CountBadgeLoading label={common.badgeLoading} className="ml-auto" />
                    : groupCount > 0 && <CountBadge count={groupCount} className="ml-auto" />}
                  <ChevronDown size={14} data-open={open} className="sidebar-group-arrow" />
                </button>
                {open && !collapsed && (
                  <ul className="sidebar-sub-nav">{entry.children.map((c) => renderLeaf(c, true))}</ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
