import {
  Award,
  BadgeCheck,
  Ban,
  BarChart3,
  Bot,
  Brush,
  Bug,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Circle,
  ClipboardList,
  Coins,
  ContactRound,
  CreditCard,
  Globe,
  Heart,
  Hospital,
  Images,
  LayoutDashboard,
  List,
  ListChecks,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  MessagesSquare,
  Package,
  Palette,
  Puzzle,
  Radio,
  Repeat,
  Rocket,
  Route,
  Settings,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Target,
  Ticket,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hiddenNavKeys, type BusinessType } from './modes';

/**
 * 側邊欄導航結構 — 1:1 對應原站 tenant/_sidebar 樣板。
 * `key` 對應 src/i18n/zh-TW/nav.ts 的文案鍵。
 * `feature` 對應功能商店的訂閱旗標（見 src/config/features.ts）；
 *   未訂閱時原站行為是「仍顯示，但點進去引導到功能商店」。
 */
export type NavLeaf = {
  key: string;
  href: string;
  icon: LucideIcon;
  feature?: string;
  badge?: string;
};
export type NavGroup = {
  key: string;
  icon: LucideIcon;
  children: NavLeaf[];
};
export type NavEntry = NavLeaf | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

export const NAV: NavEntry[] = [
  { key: 'dashboard', href: '/tenant/dashboard', icon: LayoutDashboard },
  {
    key: 'navBooking', icon: CalendarCheck, children: [
      { key: 'bookings', href: '/tenant/bookings', icon: List, feature: undefined, badge: 'pendingBookingBadge' },
      { key: 'tour_orders', href: '/tenant/tour-orders', icon: ClipboardList, feature: 'TOUR_MODULE', badge: 'pendingTourOrderBadge' },
      { key: 'recurring_bookings', href: '/tenant/recurring-bookings', icon: Repeat, feature: undefined, badge: undefined },
      { key: 'calendar', href: '/tenant/calendar', icon: Calendar, feature: undefined, badge: undefined },
      { key: 'reports', href: '/tenant/reports', icon: BarChart3, feature: 'BASIC_REPORT', badge: undefined },
      { key: 'calendar_sync', href: '/tenant/calendar-sync', icon: CalendarPlus, feature: undefined, badge: undefined },
    ],
  },
  {
    key: 'navCustomer', icon: Users, children: [
      { key: 'customers', href: '/tenant/customers', icon: ContactRound, feature: undefined, badge: undefined },
      { key: 'membership_levels', href: '/tenant/membership-levels', icon: Award, feature: 'MEMBERSHIP_SYSTEM', badge: undefined },
    ],
  },
  { key: 'chat', href: '/tenant/chat', icon: MessageSquareText, badge: 'unreadChatBadge' },
  {
    key: 'navOperation', icon: Store, children: [
      { key: 'staff', href: '/tenant/staff', icon: BadgeCheck, feature: undefined, badge: undefined },
      { key: 'services', href: '/tenant/services', icon: ListChecks, feature: undefined, badge: undefined },
      { key: 'trips', href: '/tenant/trips', icon: Route, feature: 'TOUR_MODULE', badge: undefined },
      { key: 'block_times', href: '/tenant/block-times', icon: Circle, feature: undefined, badge: undefined },
      { key: 'clinic_queue', href: '/tenant/clinic-queue', icon: Circle, feature: undefined, badge: undefined },
      { key: 'shifts', href: '/tenant/shifts', icon: CalendarDays, feature: undefined, badge: undefined },
      { key: 'payment_methods', href: '/tenant/payment-methods', icon: CreditCard, feature: undefined, badge: undefined },
      { key: 'coupons', href: '/tenant/coupons', icon: Ticket, feature: 'COUPON_SYSTEM', badge: undefined },
      { key: 'products', href: '/tenant/products', icon: Package, feature: 'PRODUCT_SALES', badge: undefined },
      { key: 'product_orders', href: '/tenant/product-orders', icon: ShoppingBag, feature: 'PRODUCT_SALES', badge: 'pendingOrderBadge' },
      { key: 'inventory', href: '/tenant/inventory', icon: ClipboardList, feature: 'INVENTORY', badge: undefined },
      { key: 'keyword_replies', href: '/tenant/keyword-replies', icon: MessageSquare, feature: 'KEYWORD_REPLY', badge: undefined },
      { key: 'ai_settings', href: '/tenant/ai-settings', icon: Bot, feature: 'AI_ASSISTANT', badge: undefined },
    ],
  },
  {
    key: 'navMarketing', icon: Megaphone, children: [
      { key: 'promote', href: '/tenant/promote', icon: Rocket, feature: undefined, badge: undefined },
      { key: 'campaigns', href: '/tenant/campaigns', icon: Target, feature: undefined, badge: undefined },
      { key: 'marketing', href: '/tenant/marketing', icon: Radio, feature: undefined, badge: undefined },
      { key: 'referrals', href: '/tenant/referrals', icon: Share2, feature: undefined, badge: undefined },
    ],
  },
  {
    key: 'navPublicPage', icon: Globe, children: [
      { key: 'shop_design', href: '/tenant/shop-design', icon: Brush, feature: undefined, badge: undefined },
      { key: 'portfolio', href: '/tenant/portfolio', icon: Images, feature: 'PORTFOLIO_SHOWCASE', badge: undefined },
    ],
  },
  {
    key: 'navSystem', icon: Settings, children: [
      { key: 'settings', href: '/tenant/settings', icon: SlidersHorizontal, feature: undefined, badge: undefined },
      { key: 'line_settings', href: '/tenant/line-settings', icon: MessagesSquare, feature: undefined, badge: undefined },
      { key: 'rich_menu_design', href: '/tenant/rich-menu-design', icon: Palette, feature: 'CUSTOM_RICH_MENU', badge: undefined },
      { key: 'feature_store', href: '/tenant/feature-store', icon: Puzzle, feature: undefined, badge: undefined },
      { key: 'points', href: '/tenant/points', icon: Coins, feature: undefined, badge: undefined },
    ],
  },
  { key: 'donate', href: '/tenant/donate', icon: Heart },
  { key: 'report_issue', href: '#', icon: Bug },
];

/**
 * 依業態模式產生側邊欄（見 src/config/modes.ts、docs/integration/13-BUSINESS-MODES.md）。
 * 隱藏 = 不顯示，**資料不刪**；換回該模式即可再看到。
 * 空群組（全部葉節點都被隱藏）自動移除。
 */
export function getNav(
  businessType: BusinessType = 'LOCAL_SHOP',
  extraModules: readonly BusinessType[] = [],
): NavEntry[] {
  const hidden = new Set(hiddenNavKeys(businessType, extraModules));
  return NAV.flatMap<NavEntry>((entry) => {
    if (!isGroup(entry)) return hidden.has(entry.key) ? [] : [entry];
    const children = entry.children.filter((c) => !hidden.has(c.key));
    return children.length ? [{ ...entry, children }] : [];
  });
}

/** 依 pathname 找出所屬的群組 key（用於預設展開） */
export function findActiveGroup(pathname: string): string | null {
  for (const e of NAV) {
    if (isGroup(e) && e.children.some((c) => pathname.startsWith(c.href))) return e.key;
  }
  return null;
}
