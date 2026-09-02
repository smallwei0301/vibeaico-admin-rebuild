import {
  BarChart3,
  Bot,
  Calendar,
  CalendarPlus,
  ContactRound,
  CreditCard,
  Heart,
  Images,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  MoreHorizontal,
  Package,
  Palette,
  Puzzle,
  Radio,
  Route,
  Settings,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { NavKey } from '@/i18n/zh-TW/nav';

export type GuideParentKey = 'home' | 'departures' | 'travelers' | 'messages' | 'more';

export type GuideParentNavItem = {
  key: GuideParentKey;
  href: string;
  icon: LucideIcon;
};

export const GUIDE_PRIMARY_NAV: readonly GuideParentNavItem[] = Object.freeze([
  { key: 'home', href: '/tenant/dashboard', icon: LayoutDashboard },
  { key: 'departures', href: '/tenant/calendar', icon: Calendar },
  { key: 'travelers', href: '/tenant/customers', icon: Users },
  { key: 'messages', href: '/tenant/chat', icon: MessageSquareText },
  { key: 'more', href: '/tenant/more', icon: MoreHorizontal },
]);

export type GuideMoreGroupKey =
  | 'operations'
  | 'payments'
  | 'travelerCare'
  | 'lineAutomation'
  | 'marketing'
  | 'platform';

export type GuideMoreLink = {
  navKey: NavKey;
  href: string;
  icon: LucideIcon;
  feature?: string;
};

export type GuideMoreGroup = {
  key: GuideMoreGroupKey;
  links: readonly GuideMoreLink[];
};

/**
 * GUIDE「更多」只組織既有真實 route，不建立第二套功能。
 * `feature` 保留原 NAV 的 gating metadata，Phase B shell/page 接線時沿用既有 feature gate。
 */
export const GUIDE_MORE_GROUPS: readonly GuideMoreGroup[] = Object.freeze([
  {
    key: 'operations',
    links: [
      { navKey: 'trips', href: '/tenant/trips', icon: Route, feature: 'TOUR_MODULE' },
      { navKey: 'staff', href: '/tenant/staff', icon: ContactRound },
      { navKey: 'reports', href: '/tenant/reports', icon: BarChart3, feature: 'BASIC_REPORT' },
      { navKey: 'calendar_sync', href: '/tenant/calendar-sync', icon: CalendarPlus },
    ],
  },
  {
    key: 'payments',
    links: [
      { navKey: 'payment_methods', href: '/tenant/payment-methods', icon: CreditCard },
      { navKey: 'products', href: '/tenant/products', icon: Package, feature: 'PRODUCT_SALES' },
      { navKey: 'product_orders', href: '/tenant/product-orders', icon: ShoppingBag, feature: 'PRODUCT_SALES' },
      { navKey: 'inventory', href: '/tenant/inventory', icon: Package, feature: 'INVENTORY' },
    ],
  },
  {
    key: 'travelerCare',
    links: [
      { navKey: 'membership_levels', href: '/tenant/membership-levels', icon: Users, feature: 'MEMBERSHIP_SYSTEM' },
      { navKey: 'coupons', href: '/tenant/coupons', icon: Ticket, feature: 'COUPON_SYSTEM' },
      { navKey: 'points', href: '/tenant/points', icon: Ticket },
    ],
  },
  {
    key: 'lineAutomation',
    links: [
      { navKey: 'line_settings', href: '/tenant/line-settings', icon: Settings },
      { navKey: 'rich_menu_design', href: '/tenant/rich-menu-design', icon: Palette, feature: 'CUSTOM_RICH_MENU' },
      { navKey: 'keyword_replies', href: '/tenant/keyword-replies', icon: MessageSquareText, feature: 'KEYWORD_REPLY' },
      { navKey: 'ai_settings', href: '/tenant/ai-settings', icon: Bot, feature: 'AI_ASSISTANT' },
    ],
  },
  {
    key: 'marketing',
    links: [
      { navKey: 'promote', href: '/tenant/promote', icon: Megaphone },
      { navKey: 'campaigns', href: '/tenant/campaigns', icon: Megaphone },
      { navKey: 'marketing', href: '/tenant/marketing', icon: Radio },
      { navKey: 'referrals', href: '/tenant/referrals', icon: Share2 },
      { navKey: 'shop_design', href: '/tenant/shop-design', icon: SlidersHorizontal },
      { navKey: 'portfolio', href: '/tenant/portfolio', icon: Images, feature: 'PORTFOLIO_SHOWCASE' },
    ],
  },
  {
    key: 'platform',
    links: [
      { navKey: 'settings', href: '/tenant/settings', icon: SlidersHorizontal },
      { navKey: 'feature_store', href: '/tenant/feature-store', icon: Puzzle },
      { navKey: 'donate', href: '/tenant/donate', icon: Heart },
    ],
  },
]);

/**
 * Existing GUIDE-visible routes that belong to a first-level parent. Routes may also be linked from
 * 「更多」as shortcuts, but the canonical parent remains stable for breadcrumbs/navigation tests.
 */
export const GUIDE_ROUTE_PARENT: Readonly<Record<string, GuideParentKey>> = Object.freeze({
  '/tenant/dashboard': 'home',
  '/tenant/calendar': 'departures',
  '/tenant/tour-orders': 'departures',
  '/tenant/trips': 'departures',
  '/tenant/customers': 'travelers',
  '/tenant/membership-levels': 'travelers',
  '/tenant/chat': 'messages',
  '/tenant/staff': 'more',
  '/tenant/reports': 'more',
  '/tenant/calendar-sync': 'more',
  '/tenant/payment-methods': 'more',
  '/tenant/products': 'more',
  '/tenant/product-orders': 'more',
  '/tenant/inventory': 'more',
  '/tenant/coupons': 'more',
  '/tenant/points': 'more',
  '/tenant/line-settings': 'more',
  '/tenant/rich-menu-design': 'more',
  '/tenant/keyword-replies': 'more',
  '/tenant/ai-settings': 'more',
  '/tenant/promote': 'more',
  '/tenant/campaigns': 'more',
  '/tenant/marketing': 'more',
  '/tenant/referrals': 'more',
  '/tenant/shop-design': 'more',
  '/tenant/portfolio': 'more',
  '/tenant/settings': 'more',
  '/tenant/feature-store': 'more',
  '/tenant/donate': 'more',
  '/tenant/more': 'more',
});

export function guideParentForPath(pathname: string): GuideParentKey | null {
  const candidates = Object.entries(GUIDE_ROUTE_PARENT)
    .filter(([href]) => pathname === href || pathname.startsWith(`${href}/`))
    .sort(([a], [b]) => b.length - a.length);
  return candidates[0]?.[1] ?? null;
}
