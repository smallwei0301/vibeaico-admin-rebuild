'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, ContactRound, MessageSquareText, MoreHorizontal } from 'lucide-react';
import { guideBottomNav as t } from '@/i18n/zh-TW/nav';
import { CountBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

/** 可能缺 key（沒有資料來源的徽章）——缺 key 視同 0，不畫徽章。與 Sidebar 的 Counts 同型。 */
type Counts = Partial<Record<string, number>>;

/**
 * GUIDE 手機五大父層級底部導航（`docs/integration/20-GUIDE-RESPONSIVE-UI.md` §2、§9
 * `GuideBottomNav`）。
 *
 * 範圍界線：本元件只負責讓五個父入口在手機 runtime 真正掛載並可導航
 * （Issue #66 gap-audit 清單第一項：「mobile bottom nav 是否真正在 runtime 掛載」）。
 * 五頁各自的視覺密度、卡片語言、與 5 張基準圖逐項比對，屬 #66 後續 Phase C
 * 施工與瀏覽器驗收，不在本次 bounded slice 範圍內。
 *
 * 「團次」父層級的 canonical 手機入口是行事曆（20 分冊 §4.1），「旅客」對應既有
 * `/tenant/customers`，「訊息」對應既有 `/tenant/chat`；四個父層級全部重用既有
 * route，不新建第二套資料或頁面。「更多」導到新的 `/tenant/more` 分組目錄頁。
 */
export function GuideBottomNav({ counts = {} }: { counts?: Counts }) {
  const pathname = usePathname();

  const items = [
    { key: 'home', href: '/tenant/dashboard', icon: LayoutDashboard, label: t.home, badge: undefined },
    { key: 'departures', href: '/tenant/calendar', icon: CalendarCheck, label: t.departures, badge: undefined },
    { key: 'travelers', href: '/tenant/customers', icon: ContactRound, label: t.travelers, badge: undefined },
    { key: 'messages', href: '/tenant/chat', icon: MessageSquareText, label: t.messages, badge: 'unreadChatBadge' },
    { key: 'more', href: '/tenant/more', icon: MoreHorizontal, label: t.more, badge: undefined },
  ] as const;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      data-testid="guide-bottom-nav"
      aria-label={t.home}
      className={cn(
        'fixed inset-x-0 bottom-0 z-modal lg:hidden',
        'flex items-stretch justify-around',
        'h-[64px] pb-[env(safe-area-inset-bottom)]',
        'border-t border-neutral-200 bg-white',
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        const count = item.badge ? counts[item.badge] ?? 0 : 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            data-active={active}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5',
              'text-xs',
              active ? 'text-primary' : 'text-secondary',
            )}
          >
            <span className="relative">
              <Icon size={22} />
              {count > 0 && <CountBadge count={count} className="absolute -right-2 -top-2" />}
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
