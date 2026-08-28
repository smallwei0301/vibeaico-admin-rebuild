'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRightCircle, BarChart3, Bell, CalendarCheck, CalendarDays,
  CalendarPlus, ClipboardCopy, Clock, Copy, DollarSign, ExternalLink, Eye,
  Hourglass, Layers, Megaphone, Package, PieChart, Radio, Rocket, Palette,
  Settings, Star, Ticket, Trash2, TrendingDown, Trophy, UserPlus, Users, X, Zap,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { getDashboardAlerts, getDashboardStats, getStaffPerformance } from '@/services/reports';
import { clearDemoData, getDemoDataStatus } from '@/services/demo-data';
import {
  addOwnerNotifyRecipient, bindOwnerNotify, clearOwnerNotify, getOwnerNotify,
  getSetupStatus, listOwnerNotifyLineUsers, removeOwnerNotifyRecipient,
} from '@/services/settings';
import { listBookings } from '@/services/bookings';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { GuideActionInbox } from '@/components/guide/GuideActionInbox';
import { byMode } from '@/mock';
import { isDemoMode } from '@/lib/api';
import { APP_URL, USE_MOCK } from '@/config/env';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import { FEATURE_EXPIRY_WARNING_DAYS } from '@/config/features';
import { common } from '@/i18n/zh-TW/common';
import { catalogLabel, navLabel, ordersLabel, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { dashboardPage as t, setupStepLabel } from '@/i18n/zh-TW/pages/dashboard';
import {
  formatCurrency, formatDate, formatNumber, formatPercent, formatTime,
} from '@/lib/utils';
import type {
  BindableLineUser, Booking, BookingStatus, DashboardAlerts, DashboardStats,
  OwnerNotifyRecipient, OwnerNotifyState, SetupStatus, StaffPerformance,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用的骨架假資料（不寫進 src/mock，避免與其他頁面衝突）                    */
/* -------------------------------------------------------------------------- */

/*
 * 這裡原本有一個 `MOCK_LINE_PLAN: 'LITE' | 'PRO' = 'LITE'`，只要 LINE 已設定就
 * 一律把統計卡標成「輕量版」——不管店家實際買的是哪個方案。
 *
 * LINE 並未開放查詢官方帳號的推播方案，所以正確做法不是換一個預設值，而是
 * 不要宣稱我們查不到的事：已設定就說「已設定」。
 * 見 CLAUDE.md「不要製造假的已知」。
 */

type ActivityType =
  | 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_COMPLETED'
  | 'CUSTOMER_CREATED' | 'ORDER_CREATED';

type RecentActivity = { id: string; type: ActivityType; name: string; target: string; at: string };

const ACTIVITY_LOCAL_SHOP: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '王小明', target: '精緻剪髮', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '陳雅婷', target: '護髮油 100ml', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '陳雅婷', target: '深層護髮', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '林佳蓉', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '陳雅婷', target: '全頭染髮', at: '2026-08-17T10:20:00+08:00' },
];

const ACTIVITY_GUIDE: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '黃思穎', target: '花蓮砂婆礑溯溪體驗', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '林巧薇', target: '防水袋 20L', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '陳彥廷', target: '龜山島賞鯨半日遊', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '吳孟儒', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '張家豪', target: '九份山城夜訪散策', at: '2026-08-17T10:20:00+08:00' },
];

const ACTIVITY_CLINIC: RecentActivity[] = [
  { id: 'a_1', type: 'BOOKING_CREATED', name: '許文彥', target: '流感疫苗接種', at: '2026-08-20T09:12:00+08:00' },
  { id: 'a_2', type: 'ORDER_CREATED', name: '蔡淑芬', target: '綜合維他命（90 錠）', at: '2026-08-20T08:40:00+08:00' },
  { id: 'a_3', type: 'BOOKING_COMPLETED', name: '劉建國', target: '複診', at: '2026-08-19T15:45:00+08:00' },
  { id: 'a_4', type: 'CUSTOMER_CREATED', name: '周佩琪', target: '', at: '2026-08-19T11:02:00+08:00' },
  { id: 'a_5', type: 'BOOKING_CANCELLED', name: '蔡淑芬', target: '成人健康檢查', at: '2026-08-17T10:20:00+08:00' },
];

type WeeklyTrendPoint = { weekday: number; bookings: number; revenue: number };
type MonthSourcePoint = { source: Booking['source']; count: number };

/** 本週預約趨勢：weekday 對應 common.weekdays 的索引（0 = 週日） */
const TREND_LOCAL_SHOP: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 6, revenue: 8400 },
  { weekday: 2, bookings: 9, revenue: 15600 },
  { weekday: 3, bookings: 4, revenue: 5200 },
  { weekday: 4, bookings: 11, revenue: 21800 },
  { weekday: 5, bookings: 14, revenue: 28600 },
  { weekday: 6, bookings: 17, revenue: 34200 },
  { weekday: 0, bookings: 8, revenue: 14600 },
];

/** 嚮導出團集中在週末與連假，平日以諮詢、整裝為主 */
const TREND_GUIDE: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 1, revenue: 3200 },
  { weekday: 2, bookings: 2, revenue: 6400 },
  { weekday: 3, bookings: 1, revenue: 2800 },
  { weekday: 4, bookings: 3, revenue: 18600 },
  { weekday: 5, bookings: 5, revenue: 42800 },
  { weekday: 6, bookings: 9, revenue: 96400 },
  { weekday: 0, bookings: 7, revenue: 78200 },
];

/** 診所平日門診量高，週末僅半日看診 */
const TREND_CLINIC: WeeklyTrendPoint[] = [
  { weekday: 1, bookings: 46, revenue: 32400 },
  { weekday: 2, bookings: 52, revenue: 38600 },
  { weekday: 3, bookings: 44, revenue: 30800 },
  { weekday: 4, bookings: 50, revenue: 36200 },
  { weekday: 5, bookings: 58, revenue: 41400 },
  { weekday: 6, bookings: 22, revenue: 15600 },
  { weekday: 0, bookings: 0, revenue: 0 },
];

/** 本月預約來源分布 */
const SOURCES_LOCAL_SHOP: MonthSourcePoint[] = [
  { source: 'LINE', count: 84 },
  { source: 'PUBLIC_PAGE', count: 41 },
  { source: 'MANUAL', count: 18 },
  { source: 'RECURRING', count: 7 },
];

const SOURCES_GUIDE: MonthSourcePoint[] = [
  { source: 'PUBLIC_PAGE', count: 38 },
  { source: 'LINE', count: 26 },
  { source: 'MANUAL', count: 14 },
  { source: 'RECURRING', count: 0 },
];

const SOURCES_CLINIC: MonthSourcePoint[] = [
  { source: 'LINE', count: 612 },
  { source: 'PUBLIC_PAGE', count: 204 },
  { source: 'RECURRING', count: 96 },
  { source: 'MANUAL', count: 48 },
];

const STATUS_TONE: Record<BookingStatus, 'primary' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

/**
 * 快速操作六格。
 *
 * ⚠️ 這裡原本是模組層的 `const QUICK_ACTIONS`，把 `/tenant/bookings` 與
 * `/tenant/services` 寫死——那兩頁在嚮導的 `hiddenNavKeys` 裡，按下去會進到他
 * 選單中根本不存在的頁面（14 分冊 §8.13）。而且模組層 const 在 AppShell 決定
 * 模式**之前**就求值，就算改讀 preset 也會凍住錯的模式（CLAUDE.md 的模組層陷阱）。
 * 因此改成函式，由頁面在 render 期帶著當下的 businessType 呼叫。
 */
function buildQuickActions(businessType: BusinessType) {
  const preset = MODE_PRESETS[businessType];
  return [
    { key: 'newBooking', href: preset.ordersHref, label: ordersLabel(businessType), icon: CalendarCheck },
    { key: 'calendar', href: '/tenant/calendar', label: navLabel('calendar', businessType), icon: CalendarDays },
    { key: 'customers', href: '/tenant/customers', label: navLabel('customers', businessType), icon: Users },
    { key: 'services', href: preset.catalogHref, label: catalogLabel(businessType), icon: Layers },
    { key: 'marketing', href: '/tenant/marketing', label: navLabel('marketing', businessType), icon: Megaphone },
    { key: 'settings', href: '/tenant/settings', label: navLabel('settings', businessType), icon: Settings },
  ] as const;
}

/** 統計卡在資料載入前的佔位符（原站 DOM 即為「-」） */
const PLACEHOLDER = '-';



const daysUntil = (isoDate: string) =>
  Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000);

/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const currentTenant = useCurrentTenant();
  /**
   * 「目錄／訂單」是父層級概念，三種模式各指向自己的子層級頁面（14 分冊 §8.13）。
   * 這兩個值只能在 render 期取——模組層取會凍住錯的模式。
   */
  const businessType = useBusinessType();
  const catalogHref = MODE_PRESETS[businessType].catalogHref;
  const ordersHref = MODE_PRESETS[businessType].ordersHref;
  const quickActions = buildQuickActions(businessType);
  const PUBLIC_BOOKING_URL = buildPublicBookingUrl(APP_URL, currentTenant.shopCode);
  const toast = useToast();

  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = React.useState<DashboardAlerts | null>(null);
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);
  const [performance, setPerformance] = React.useState<StaffPerformance[]>([]);
  const [todayRows, setTodayRows] = React.useState<Booking[]>([]);

  const [loadingToday, setLoadingToday] = React.useState(true);
  const [loadingPerformance, setLoadingPerformance] = React.useState(true);
  const [loadingActivity, setLoadingActivity] = React.useState(true);
  const [activity, setActivity] = React.useState<RecentActivity[]>([]);

  /** 骨架模式或正在看示範店家時才顯示尚無端點的展示用假資料 */
  const showSampleData = USE_MOCK || isDemoMode();

  /**
   * 空後台指引：只給「真實模式、看自己的店、而且真的還沒有任何預約」的新店家，
   * 關掉後記在 localStorage 不再出現（每家店各自記，換店不會互相影響）。
   */
  const demoHintKey = `vibeai.demoHint.dismissed.${currentTenant.id}`;
  const [demoHintDismissed, setDemoHintDismissed] = React.useState(true);
  React.useEffect(() => {
    if (showSampleData || !currentTenant.id) return;
    try {
      setDemoHintDismissed(localStorage.getItem(demoHintKey) === 'true');
    } catch { setDemoHintDismissed(false); }
  }, [demoHintKey, showSampleData, currentTenant.id]);
  const dismissDemoHint = () => {
    setDemoHintDismissed(true);
    try { localStorage.setItem(demoHintKey, 'true'); } catch { /* 無痕視窗：關掉這次就好 */ }
  };

  /**
   * 示範資料：新店註冊時依業態鋪好的範例。有殘留才顯示「一鍵清空」卡片。
   * 示範店家（demo 模式）本來整站就是假資料，沒有這個子集合的概念，故不查。
   */
  const [demoCount, setDemoCount] = React.useState(0);
  const [clearingDemo, setClearingDemo] = React.useState(false);
  const [confirmClearDemo, setConfirmClearDemo] = React.useState(false);
  const reloadDemoCount = React.useCallback(() => {
    if (showSampleData) return;
    void getDemoDataStatus().then((r) => setDemoCount(r.total)).catch(() => {});
  }, [showSampleData]);
  React.useEffect(() => { reloadDemoCount(); }, [reloadDemoCount]);

  const doClearDemo = async () => {
    setClearingDemo(true);
    try {
      await clearDemoData();
      setDemoCount(0);
      toast.show(t.demoData.cleared);
    } catch (e) {
      toast.show(`${t.demoData.clearFailed}${e instanceof Error ? e.message : ''}`, 'danger');
    } finally {
      setClearingDemo(false);
      setConfirmClearDemo(false);
    }
  };

  /* ------------------------------------------ 老闆通知（owner-notify，issue #18）
   * 名單、可加入的好友、四支端點的 handler。狀態一律來自後端（getOwnerNotify），
   * 頁面不自己推導「應該是已開啟吧」——三＋一態的判定見 06 分冊 §5.5。
   */
  const [ownerNotify, setOwnerNotify] = React.useState<OwnerNotifyState | null>(null);
  const [bindable, setBindable] = React.useState<BindableLineUser[]>([]);
  const [pickedLineUser, setPickedLineUser] = React.useState('');
  const [ownerNotifyBusy, setOwnerNotifyBusy] = React.useState(false);
  /** 開著的確認視窗：新增／本人綁定／移除某一位／解除全部 */
  const [onConfirm, setOnConfirm] = React.useState<
    | { kind: 'ADD' | 'BIND_SELF' }
    | { kind: 'REMOVE'; recipient: OwnerNotifyRecipient }
    | { kind: 'CLEAR' }
    | null
  >(null);

  const reloadOwnerNotify = React.useCallback(async () => {
    const [state, users] = await Promise.all([getOwnerNotify(), listOwnerNotifyLineUsers()]);
    setOwnerNotify(state);
    setBindable(users.lineUsers);
    setPickedLineUser((prev) => (users.lineUsers.some((u) => u.lineUserId === prev) ? prev : ''));
  }, []);

  const [focusOpen, setFocusOpen] = React.useState(true);
  const [confirmSkipFocus, setConfirmSkipFocus] = React.useState(false);
  const [calSyncPromoOpen, setCalSyncPromoOpen] = React.useState(true);

  const fail = React.useCallback(
    (prefix: string, e: unknown) =>
      toast.show(`${prefix}${e instanceof Error ? e.message : t.errors.loadFailed}`, 'danger'),
    [toast],
  );

  React.useEffect(() => {
    void (async () => {
      try { setStats(await getDashboardStats()); } catch (e) { fail(t.errors.stats, e); }
    })();
    void (async () => {
      try { setAlerts(await getDashboardAlerts()); } catch (e) { fail(t.errors.alerts, e); }
    })();
    void (async () => {
      try { setSetup(await getSetupStatus()); } catch (e) { fail(t.errors.setupStatus, e); }
    })();
    void (async () => {
      try { await reloadOwnerNotify(); } catch (e) { fail(t.ownerNotify.errors.load, e); }
    })();
    void (async () => {
      try {
        setPerformance(await getStaffPerformance());
      } catch (e) { fail(t.errors.staffPerformance, e); } finally { setLoadingPerformance(false); }
    })();
    void (async () => {
      try {
        const today = formatDate(new Date().toISOString());
        const res = await listBookings({ page: 0, size: 50 });
        setTodayRows(res.content.filter((b) => formatDate(b.startAt) === today));
      } catch (e) { fail(t.errors.todayBookings, e); } finally { setLoadingToday(false); }
    })();
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 320));
        // 這三塊（最近活動／週趨勢／預約來源）契約上還沒有對應端點（04 分冊只定義了
        // dashboard、dashboard-alerts、staff-performance），骨架階段用假資料撐版面。
        // 真實店家不能看到別家店的示範資料——新註冊的店後台必須是乾淨的，所以
        // real 模式一律回空，由各自的 EmptyState 呈現。
        setActivity(showSampleData
          ? byMode({ LOCAL_SHOP: ACTIVITY_LOCAL_SHOP, GUIDE: ACTIVITY_GUIDE, CLINIC: ACTIVITY_CLINIC })
          : []);
      } catch (e) { fail(t.errors.recentActivity, e); } finally { setLoadingActivity(false); }
    })();
  }, [fail, reloadOwnerNotify, showSampleData]);

  const weeklyTrend = showSampleData
    ? byMode({ LOCAL_SHOP: TREND_LOCAL_SHOP, GUIDE: TREND_GUIDE, CLINIC: TREND_CLINIC })
    : [];
  const monthSources = showSampleData
    ? byMode({ LOCAL_SHOP: SOURCES_LOCAL_SHOP, GUIDE: SOURCES_GUIDE, CLINIC: SOURCES_CLINIC })
    : [];

  const copyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(PUBLIC_BOOKING_URL);
      toast.show(t.publicUrl.copied);
    } catch {
      toast.show(`${t.publicUrl.manualCopy}${PUBLIC_BOOKING_URL}`, 'warning');
    }
  };

  /* --------------------------------------- 老闆通知的四個動作（每個都真的打端點）
   * 成功訊息一律在端點回來之後才顯示；失敗就顯示端點回的 message（例如
   * 「已達上限 3 位…」），不吞掉、也不改寫成一句籠統的「操作失敗」。
   */
  const ownerRecipients = ownerNotify?.recipients ?? [];
  const ownerMax = ownerNotify?.maxRecipients ?? 0;
  const ownerAtLimit = !!ownerNotify && ownerRecipients.length >= ownerMax;
  const recipientName = (r: { displayName: string }) => r.displayName || t.ownerNotify.unnamed;
  /** 移除某一位之後會遞補成主要的那一位（＝名單順序的下一位） */
  const nextAfter = (r: OwnerNotifyRecipient) =>
    ownerRecipients.find((x) => x.lineUserId !== r.lineUserId) ?? null;

  const runOwnerNotify = async (action: () => Promise<void>, successMessage: string) => {
    setOwnerNotifyBusy(true);
    try {
      await action();
      await reloadOwnerNotify();
      toast.show(successMessage);
    } catch (e) {
      toast.show(
        e instanceof Error && e.message ? e.message : t.ownerNotify.toast.bindFailed,
        'danger',
      );
    } finally {
      setOwnerNotifyBusy(false);
      setOnConfirm(null);
    }
  };

  const confirmOwnerNotify = () => {
    if (!onConfirm) return;
    if (onConfirm.kind === 'BIND_SELF')
      void runOwnerNotify(
        async () => { await bindOwnerNotify(pickedLineUser); },
        t.ownerNotify.toast.bound,
      );
    else if (onConfirm.kind === 'ADD')
      void runOwnerNotify(
        async () => { await addOwnerNotifyRecipient(pickedLineUser); },
        t.ownerNotify.toast.added,
      );
    else if (onConfirm.kind === 'REMOVE') {
      const { recipient } = onConfirm;
      void runOwnerNotify(
        async () => { await removeOwnerNotifyRecipient(recipient.lineUserId); },
        t.ownerNotify.toast.removed,
      );
    } else void runOwnerNotify(async () => { await clearOwnerNotify(); }, t.ownerNotify.toast.unbound);
  };

  /** 三種移除確認文案（規格逐字）：最後一位／主要（帶遞補者名字）／其他 */
  const removeMessage = (r: OwnerNotifyRecipient): string => {
    if (ownerRecipients.length === 1) return t.ownerNotify.confirm.removeLast;
    if (r.isPrimary) {
      const next = nextAfter(r);
      return t.ownerNotify.confirm.removePrimary(next ? recipientName(next) : t.ownerNotify.unnamed);
    }
    return t.ownerNotify.confirm.removeOther;
  };

  const ownerConfirmMessage = (): string => {
    if (!onConfirm) return '';
    if (onConfirm.kind === 'BIND_SELF') return t.ownerNotify.confirm.bindSelf;
    if (onConfirm.kind === 'ADD') return t.ownerNotify.confirm.add;
    if (onConfirm.kind === 'REMOVE') return removeMessage(onConfirm.recipient);
    return t.ownerNotify.confirm.unbindAll(ownerRecipients.length);
  };

  const ownerStatusLabel = (): string => {
    switch (ownerNotify?.status) {
      case 'ENABLED': return t.ownerNotify.status.enabled;
      case 'DISCONNECTED': return t.ownerNotify.status.disconnected;
      case 'NO_RECIPIENTS': return t.ownerNotify.status.noRecipients;
      default: return t.ownerNotify.status.notConfigured;
    }
  };

  const setupDone = setup?.steps.filter((s) => s.done).length ?? 0;
  const setupAllDone = !!setup && setupDone === setup.steps.length;

  const quotaUsed = stats?.pushQuotaUsed ?? 0;
  const quotaTotal = stats?.pushQuotaTotal ?? 0;
  const quotaPct = quotaTotal ? Math.round((quotaUsed / quotaTotal) * 100) : 0;
  const quotaRemaining = Math.max(quotaTotal - quotaUsed, 0);

  const linePlanLabel =
    stats?.linePlatformStatus === 'NOT_CONFIGURED' ? t.stats.lineNotConfigured
      : stats?.linePlatformStatus === 'ERROR' ? t.stats.unknown
        : t.stats.lineConfigured;

  const todayColumns: Column<Booking>[] = [
    { key: 'time', header: t.todayBookings.columns.time, width: '84px', render: (b) => formatTime(b.startAt) },
    {
      key: 'customer', header: t.todayBookings.columns.customer,
      render: (b) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{b.customerName}</div>
          {b.source === 'LINE' ? (
            <div className="text-xs text-secondary">{t.todayBookings.lineUser}</div>
          ) : null}
        </div>
      ),
    },
    { key: 'service', header: t.todayBookings.columns.service, render: (b) => b.serviceName },
    {
      key: 'staff', header: t.todayBookings.columns.staff,
      render: (b) => b.staffName ?? <span className="text-muted">{t.todayBookings.unassigned}</span>,
    },
    {
      key: 'status', header: t.todayBookings.columns.status, width: '92px',
      render: (b) => <Badge tone={STATUS_TONE[b.status]}>{common.bookingStatus[b.status]}</Badge>,
    },
  ];

  const performanceColumns: Column<StaffPerformance>[] = [
    { key: 'staff', header: t.staffPerformance.columns.staff, render: (s) => s.staffName },
    {
      key: 'bookings', header: t.staffPerformance.columns.bookings, numeric: true,
      render: (s) => formatNumber(s.bookingCount),
    },
    {
      key: 'rate', header: t.staffPerformance.columns.completionRate, numeric: true,
      render: (s) => formatPercent(s.completionRate, 1),
    },
    {
      key: 'revenue', header: t.staffPerformance.columns.revenue, numeric: true,
      render: (s) => formatCurrency(s.revenue),
    },
  ];

  const maxWeeklyBookings = Math.max(...weeklyTrend.map((d) => d.bookings), 1);
  const maxWeeklyRevenue = Math.max(...weeklyTrend.map((d) => d.revenue), 1);
  const sourceTotal = monthSources.reduce((sum, s) => sum + s.count, 0);

  // 有資料的店不需要這張指引卡——等 stats 載入完再判斷，避免載入中閃一下又消失。
  const shopIsEmpty = !!stats
    && stats.todayBookings === 0 && stats.pendingBookings === 0 && stats.totalCustomers === 0;
  const showDemoHint = !showSampleData && !demoHintDismissed && shopIsEmpty;

  return (
    <>
      <PageHeader title={t.title} />

      {MODE_PRESETS[businessType].dashboardPrimary === 'ACTION_INBOX' ? <GuideActionInbox /> : null}

      {/* -------------------------------------- 空後台指引：先去看示範店家長怎樣 */}
      {showDemoHint ? (
        <Alert tone="info" className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-1 font-bold">{t.demoHint.title}</div>
              <p className="text-sm">{t.demoHint.body}</p>
            </div>
            <Button variant="outline" size="sm" onClick={dismissDemoHint}>
              {t.demoHint.dismiss}
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* ------------------------------------------ 示範資料提示＋一鍵清空 */}
      {!showSampleData && demoCount > 0 ? (
        <Alert tone="warning" className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-1 font-bold">{t.demoData.title}</div>
              <p className="text-sm">{t.demoData.body(demoCount)}</p>
            </div>
            <Button
              variant="outline" size="sm"
              loading={clearingDemo} loadingText={t.demoData.clearing}
              onClick={() => setConfirmClearDemo(true)}
            >
              {t.demoData.clear}
            </Button>
          </div>
        </Alert>
      ) : null}

      <ConfirmModal
        open={confirmClearDemo}
        title={t.demoData.confirmTitle}
        message={t.demoData.confirmBody}
        danger
        loading={clearingDemo}
        onClose={() => setConfirmClearDemo(false)}
        onConfirm={() => void doClearDemo()}
      />

      {/* ------------------------------------------------ 3 分鐘開始收單 引導卡 */}
      {focusOpen ? (
        <Card className="mb-4 border-primary bg-gradient-primary text-neutral-0">
          <CardBody>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-md font-bold">
                <Rocket size={18} />
                {t.focus.title}
              </div>
              <button
                type="button"
                aria-label={t.focus.close}
                className="btn btn-ghost btn-icon text-neutral-0"
                onClick={() => setConfirmSkipFocus(true)}
              >
                <X size={16} />
              </button>
            </div>

            <ol className="flex flex-col gap-3">
              <li className="flex flex-wrap items-center gap-3 rounded-lg bg-primary-deep p-3">
                <Badge tone="neutral">{t.focus.step1Badge}</Badge>
                <span className="flex-1 text-base font-semibold">{resolveNavTerms(t.focus.step1Title, businessType)}</span>
                <Link href={catalogHref} className="btn btn-secondary text-primary">
                  {t.focus.step1Action}
                </Link>
              </li>
              <li className="flex flex-wrap items-center gap-3 rounded-lg bg-primary-deep p-3">
                <Badge tone="neutral">{t.focus.step2Badge}</Badge>
                <span className="flex-1 text-base font-semibold">{t.focus.step2Title}</span>
                {setupAllDone ? (
                  <Button variant="secondary" className="text-primary" onClick={() => void copyPublicUrl()}>
                    <ClipboardCopy size={15} />
                    {t.focus.step2Action}
                  </Button>
                ) : (
                  <Button variant="outline" className="text-neutral-0" disabled>
                    <ClipboardCopy size={15} />
                    {t.focus.step2Locked}
                  </Button>
                )}
              </li>
            </ol>

            {setupAllDone ? (
              <Alert tone="success" className="mt-4">
                <span className="flex flex-wrap items-center gap-2">
                  {t.focus.readyBanner}
                  <a href={PUBLIC_BOOKING_URL} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
                    <ExternalLink size={13} />
                    {t.focus.readyOpen}
                  </a>
                </span>
              </Alert>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a href={PUBLIC_BOOKING_URL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                <Eye size={13} />
                {t.focus.viewPublicPage}
              </a>
              <Link href="/tenant/coupons" className="btn btn-secondary btn-sm">
                <Ticket size={13} />
                {t.focus.firstCoupon}
              </Link>
              <Link href="/tenant/shop-design" className="btn btn-secondary btn-sm">
                <Palette size={13} />
                {t.focus.customDesign}
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* -------------------------------------------------------- 設定進度卡 */}
      {setup && !setupAllDone ? (
        <Card className="mb-4">
          <CardBody>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-md font-bold">
                <Rocket size={18} className="text-primary" />
                {t.setup.title}
              </div>
              <div className="text-xs font-semibold text-secondary">
                {t.setup.progressLabel} {t.setup.percent(setup.percent)}
              </div>
            </div>

            <div className="mb-4 h-2 w-full overflow-hidden rounded-pill bg-neutral-200">
              <div className="h-full rounded-pill bg-primary" style={{ width: `${setup.percent}%` }} />
            </div>

            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {setup.steps.map((s) => (
                <li key={s.key} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
                  <span
                    aria-label={s.done ? t.setup.done : t.setup.todo}
                    className={s.done
                      ? 'flex h-5 w-5 items-center justify-center rounded-pill bg-success text-2xs text-neutral-0'
                      : 'flex h-5 w-5 items-center justify-center rounded-pill bg-neutral-250 text-2xs text-neutral-600'}
                  >
                    {s.done ? '✓' : '·'}
                  </span>
                  <span className={s.done ? 'text-sm text-secondary line-through' : 'text-sm font-semibold text-dark'}>
                    {setupStepLabel(s.key, currentTenant.businessType)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------ 警示區 */}
      {alerts?.bookingCutoffPassed ? (
        <Alert
          tone="danger"
          className="mb-4"
          title={t.cutoffExpired.title(alerts.bookingCutoffDate ? formatDate(alerts.bookingCutoffDate) : common.none)}
          action={<Link href="/tenant/settings" className="btn btn-danger btn-sm"><Settings size={13} />{t.cutoffExpired.action}</Link>}
        >
          {t.cutoffExpired.body}
        </Alert>
      ) : null}

      {alerts && alerts.expiredFeatures.length > 0 ? (
        <Card className="mb-4 border-danger">
          <CardBody>
            <div className="mb-1 flex items-center gap-2 text-md font-bold text-danger">
              <AlertTriangle size={18} />
              {t.expiredFeatures.title}
            </div>
            <p className="text-base text-neutral-700">
              {t.expiredFeatures.body}
              <strong>{t.expiredFeatures.bodyStrong}</strong>
              {t.expiredFeatures.bodyEnd}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {alerts.expiredFeatures.map((code) => (
                <Badge key={code} tone="danger">
                  {t.featureNames[code as keyof typeof t.featureNames] ?? code}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {alerts && alerts.expiringFeatures.length > 0 ? (
        <Card className="mb-4 border-info">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-md font-bold">
                <Bell size={18} className="text-info" />
                {t.expiringFeatures.title}
              </div>
              <p className="form-text">{t.expiringFeatures.body}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {alerts.expiringFeatures.map((f) => {
                  const days = daysUntil(f.expiresAt);
                  return (
                    <li key={f.code} className="flex items-center gap-1.5 text-sm">
                      <Badge tone="info">{t.featureNames[f.code as keyof typeof t.featureNames] ?? f.code}</Badge>
                      <span className="text-secondary">
                        {days <= 0
                          ? t.expiringFeatures.expiresToday
                          : t.expiringFeatures.expiresInDays(Math.min(days, FEATURE_EXPIRY_WARNING_DAYS))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <Link href="/tenant/feature-store" className="btn btn-primary btn-sm flex-shrink-0 whitespace-nowrap">
              {t.expiringFeatures.action}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {alerts?.pushQuotaExhausted ? (
        <Card className="mb-4 border-danger">
          <CardBody>
            <div className="mb-1 flex items-center gap-2 text-md font-bold text-danger">
              <Radio size={18} />
              {t.pushQuotaExhausted.title}
            </div>
            <p className="text-base text-neutral-700">{t.pushQuotaExhausted.body}</p>
            <p className="mt-2 text-base text-neutral-700">
              {t.pushQuotaExhausted.upgradeHint}
              <strong className="mx-1">{t.pushQuotaExhausted.upgradePlan}</strong>
              {t.pushQuotaExhausted.orReset}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!alerts?.pushQuotaExhausted && quotaTotal > 0 && quotaPct >= 80 ? (
        <Card className="mb-4">
          <CardBody>
            <div className="mb-1 flex items-center gap-2 text-md font-bold text-warning">
              <AlertTriangle size={18} />
              {quotaPct >= 95 ? t.pushQuotaWarning.almostOut : t.pushQuotaWarning.over80}
            </div>
            <p className="text-base text-neutral-700">
              {t.pushQuotaWarning.usage(quotaUsed, quotaTotal, quotaPct, quotaRemaining)}
            </p>
            <p className="form-text">{t.pushQuotaWarning.resetHint}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* ------------------------------------------ LINE 老闆通知（issue #18） */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Bell size={16} />
            {t.ownerNotify.title}
          </CardTitle>
          <Badge
            tone={
              ownerNotify?.status === 'ENABLED' ? 'success'
                : ownerNotify?.status === 'DISCONNECTED' ? 'danger' : 'neutral'
            }
          >
            {ownerNotify ? ownerStatusLabel() : PLACEHOLDER}
          </Badge>
        </CardHeader>
        <CardBody>
          {ownerNotify?.status === 'DISCONNECTED' ? (
            <Alert tone="danger" className="mb-3">
              {t.ownerNotify.disconnectedHint}
              <Link href="/tenant/line-settings">{t.ownerNotify.disconnectedHintLink}</Link>
              {t.ownerNotify.disconnectedHintTail}
            </Alert>
          ) : null}
          {ownerNotify?.status === 'NOT_CONFIGURED' ? (
            <Alert tone="warning" className="mb-3">{t.ownerNotify.notConfiguredHint}</Alert>
          ) : null}

          {ownerRecipients.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={t.ownerNotify.status.noRecipients}
              description={t.ownerNotify.noRecipientsHint}
            />
          ) : (
            <>
              <ul className="mb-3 flex flex-col gap-2">
                {ownerRecipients.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold text-dark">{recipientName(r)}</span>
                      {r.isPrimary ? (
                        <Badge tone="primary">
                          <Star size={12} />
                          {t.ownerNotify.primaryBadge}
                        </Badge>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ownerNotifyBusy}
                      onClick={() => setOnConfirm({ kind: 'REMOVE', recipient: r })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="form-text">{t.ownerNotify.fanout(ownerRecipients.length)}</p>
              <p className="form-text">{t.ownerNotify.primaryHint}</p>
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              className="max-w-xs"
              value={pickedLineUser}
              disabled={ownerNotifyBusy || ownerAtLimit || bindable.length === 0}
              onChange={(e) => setPickedLineUser(e.target.value)}
            >
              <option value="">
                {bindable.length === 0
                  ? t.ownerNotify.noBindableUsers
                  : t.ownerNotify.selectPlaceholder}
              </option>
              {bindable.map((u) => (
                <option key={u.lineUserId} value={u.lineUserId}>
                  {u.displayName || t.ownerNotify.unnamed}
                </option>
              ))}
            </Select>
            {ownerRecipients.length === 0 ? (
              <Button
                variant="primary"
                size="sm"
                disabled={ownerNotifyBusy || !pickedLineUser}
                onClick={() => setOnConfirm({ kind: 'BIND_SELF' })}
              >
                <Bell size={14} />
                {t.ownerNotify.bindSelf}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={ownerNotifyBusy || !pickedLineUser || ownerAtLimit}
                onClick={() => setOnConfirm({ kind: 'ADD' })}
              >
                <UserPlus size={14} />
                {t.ownerNotify.addRecipient}
              </Button>
            )}
            {ownerAtLimit ? (
              <span className="text-sm text-warning">{t.ownerNotify.atLimit(ownerMax)}</span>
            ) : null}
            {ownerRecipients.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={ownerNotifyBusy}
                onClick={() => setOnConfirm({ kind: 'CLEAR' })}
              >
                {t.ownerNotify.unbindAll}
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <ConfirmModal
        open={!!onConfirm}
        onClose={() => setOnConfirm(null)}
        onConfirm={confirmOwnerNotify}
        title={t.ownerNotify.title}
        message={ownerConfirmMessage()}
        danger={onConfirm?.kind === 'REMOVE' || onConfirm?.kind === 'CLEAR'}
        loading={ownerNotifyBusy}
      />

      {/* -------------------------------------------------------------- 統計卡 */}
      <div className="mb-4 grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-5">
        <Link href={ordersHref} className="no-underline">
          <StatCard
            label={t.stats.todayBookings}
            value={stats ? formatNumber(stats.todayBookings) : PLACEHOLDER}
            icon={CalendarCheck}
            tone="primary"
          />
        </Link>
        <Link href={`${ordersHref}?status=PENDING`} className="no-underline">
          <StatCard
            label={t.stats.pendingBookings}
            value={stats ? formatNumber(stats.pendingBookings) : PLACEHOLDER}
            icon={Hourglass}
            tone="warning"
          />
        </Link>
        <Link href="/tenant/reports" className="no-underline">
          <StatCard
            label={t.stats.monthRevenue}
            value={stats ? formatCurrency(stats.monthRevenue) : PLACEHOLDER}
            icon={DollarSign}
            tone="success"
          />
        </Link>
        <Link href="/tenant/customers" className="no-underline">
          <StatCard
            label={t.stats.totalCustomers}
            value={stats ? formatNumber(stats.totalCustomers) : PLACEHOLDER}
            icon={Users}
            tone="info"
          />
        </Link>
        <Link href="/tenant/points" className="no-underline">
          <StatCard
            label={t.stats.pushQuota}
            value={stats
              ? (quotaRemaining === 0 ? t.stats.exhausted : t.stats.quotaValue(quotaUsed, quotaTotal))
              : common.none}
            icon={Radio}
            tone="neutral"
            hint={`${t.stats.linePlatform} · ${stats ? linePlanLabel : PLACEHOLDER}`}
          />
        </Link>
      </div>

      {/* ---------------------------------------------------- 行事曆同步推廣卡 */}
      {calSyncPromoOpen ? (
        <Alert
          tone="primary"
          className="mb-4"
          icon={<CalendarPlus size={18} className="mt-0.5 flex-shrink-0" />}
          title={t.calendarSyncPromo.title}
          action={
            <div className="flex items-center gap-1">
              <Link href="/tenant/calendar-sync" className="btn btn-primary btn-sm">
                <ArrowRightCircle size={13} />
                {t.calendarSyncPromo.action}
              </Link>
              <button
                type="button"
                aria-label={t.calendarSyncPromo.dismiss}
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setCalSyncPromoOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          }
        >
          {t.calendarSyncPromo.body}
        </Alert>
      ) : null}

      {/* -------------------------------------------------------------- 警示卡 */}
      <div className="mb-4 grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="border-danger">
          <CardBody className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-md font-bold text-danger">
                <Clock size={16} />
                {t.alertCards.unprocessedBookings.title}
              </div>
              <p className="form-text">
                {t.alertCards.unprocessedBookings.body(alerts?.unprocessedBookings ?? 0)}
              </p>
            </div>
            <Link
              href={`${ordersHref}?status=UNPROCESSED`}
              className="btn btn-primary btn-sm flex-shrink-0 whitespace-nowrap"
            >
              {t.alertCards.unprocessedBookings.action}
            </Link>
          </CardBody>
        </Card>

        <Card className="border-danger">
          <CardBody className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-md font-bold text-danger">
                <Package size={16} />
                {t.alertCards.lowStock.title}
              </div>
              <p className="form-text">{t.alertCards.lowStock.body(alerts?.lowStockProducts ?? 0)}</p>
            </div>
            <Link href="/tenant/products" className="btn btn-primary btn-sm flex-shrink-0 whitespace-nowrap">
              {t.alertCards.lowStock.action}
            </Link>
          </CardBody>
        </Card>

        <Card className="border-warning">
          <CardBody className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-md font-bold text-warning">
                <TrendingDown size={16} />
                {t.alertCards.atRiskCustomers.title}
              </div>
              <p className="form-text">{t.alertCards.atRiskCustomers.body(alerts?.atRiskCustomers ?? 0)}</p>
            </div>
            <Link href="/tenant/customers?filter=atRisk" className="btn btn-primary btn-sm flex-shrink-0 whitespace-nowrap">
              {t.alertCards.atRiskCustomers.action}
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* -------------------------------------------------------------- 快速操作 */}
      <Card className="mb-4">
        <CardBody>
          <h2 className="mb-3 flex items-center gap-2 text-md font-bold">
            <Zap size={16} className="text-warning" />
            {t.quickActions.title}
          </h2>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {quickActions.map(({ key, href, label, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                className="flex flex-col items-center gap-2 rounded-lg bg-neutral-50 px-3 py-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                <Icon size={20} className="text-primary" />
                {label}
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- 公開預約網址 */}
      <Alert
        tone="primary"
        className="mb-4"
        icon={<ExternalLink size={18} className="mt-0.5 flex-shrink-0" />}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void copyPublicUrl()}>
              <Copy size={13} />
              {t.publicUrl.copy}
            </Button>
            <a href={PUBLIC_BOOKING_URL} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink size={13} />
              {t.publicUrl.open}
            </a>
          </div>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t.publicUrl.label}</span>
          <code className="break-all font-mono text-sm">
            {currentTenant.shopCode ? PUBLIC_BOOKING_URL : t.publicUrl.pendingShopCode}
          </code>
        </span>
      </Alert>

      {/* -------------------------------------------------- 今日預約 / 最近活動 */}
      <div className="mb-4 grid gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <CalendarDays size={16} className="text-primary" />
              {t.todayBookings.title}
              <span className="form-text">{t.todayBookings.count(todayRows.length)}</span>
            </CardTitle>
            <Link href={ordersHref} className="btn btn-primary btn-sm">
              {t.todayBookings.viewAll}
            </Link>
          </CardHeader>
          <DataTable
            columns={todayColumns}
            rows={todayRows}
            loading={loadingToday}
            rowKey={(b) => b.id}
            empty={<EmptyState icon={CalendarDays} title={common.noData} />}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Bell size={16} className="text-primary" />
              {t.recentActivity.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {loadingActivity ? (
              <div className="py-8 text-center text-muted">{common.loading}</div>
            ) : activity.length === 0 ? (
              <EmptyState icon={Bell} title={t.recentActivity.empty} />
            ) : (
              <ul className="flex flex-col gap-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 border-b border-neutral-200 pb-3 last:border-b-0 last:pb-0">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-pill bg-primary" />
                    <div className="min-w-0">
                      <div className="text-sm text-neutral-800">
                        {a.type === 'CUSTOMER_CREATED'
                          ? t.recentActivity.types.CUSTOMER_CREATED(a.name)
                          : t.recentActivity.types[a.type](a.name, a.target)}
                      </div>
                      <div className="text-xs text-secondary">{formatDate(a.at)} {formatTime(a.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------------ 員工業績（本月） */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Trophy size={16} className="text-warning" />
            {t.staffPerformance.title}
          </CardTitle>
          <Link href="/tenant/reports" className="btn btn-outline btn-sm">
            {t.staffPerformance.detail}
          </Link>
        </CardHeader>
        <DataTable
          columns={performanceColumns}
          rows={performance}
          loading={loadingPerformance}
          rowKey={(s) => s.staffId}
          empty={<EmptyState icon={Trophy} title={t.staffPerformance.empty} />}
        />
      </Card>

      {/* ------------------------------------------------------------ 圖表區 */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <BarChart3 size={16} className="text-primary" />
              {t.weeklyTrend.title}
            </CardTitle>
            <Link href="/tenant/reports" className="btn btn-outline btn-sm">
              {t.weeklyTrend.detailReport}
            </Link>
          </CardHeader>
          <CardBody>
            {weeklyTrend.length === 0 ? (
              <EmptyState icon={BarChart3} title={t.weeklyTrend.empty} />
            ) : (
            <>
            <div className="mb-3 flex items-center gap-4 text-xs text-secondary">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-xs bg-primary" />
                {t.weeklyTrend.bookingCount}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-xs bg-success" />
                {t.weeklyTrend.revenue}
              </span>
            </div>
            <div className="flex h-40 items-end gap-2">
              {weeklyTrend.map((d) => (
                <div key={d.weekday} className="flex h-full flex-1 flex-col justify-end gap-1">
                  <div className="flex h-full items-end gap-1">
                    <div
                      className="flex-1 rounded-sm bg-primary"
                      style={{ height: `${Math.max((d.bookings / maxWeeklyBookings) * 100, 4)}%` }}
                      title={`${t.weeklyTrend.tooltipBookings}${formatNumber(d.bookings)}`}
                    />
                    <div
                      className="flex-1 rounded-sm bg-success"
                      style={{ height: `${Math.max((d.revenue / maxWeeklyRevenue) * 100, 4)}%` }}
                      title={`${t.weeklyTrend.tooltipRevenue}${formatNumber(d.revenue)}`}
                    />
                  </div>
                  <div className="text-center text-2xs text-secondary">{common.weekdays[d.weekday]}</div>
                </div>
              ))}
            </div>
            </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <PieChart size={16} className="text-primary" />
              {t.monthSource.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {sourceTotal === 0 ? (
              <EmptyState icon={PieChart} title={t.monthSource.empty} />
            ) : (
              <ul className="flex flex-col gap-3">
                {monthSources.map((s) => {
                  const pct = Math.round((s.count / sourceTotal) * 100);
                  return (
                    <li key={s.source}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-semibold text-neutral-800">{common.bookingSource[s.source]}</span>
                        <span className="tabular-nums text-secondary">
                          {formatNumber(s.count)} · {formatPercent(pct)}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-pill bg-neutral-200">
                        <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        open={confirmSkipFocus}
        onClose={() => setConfirmSkipFocus(false)}
        onConfirm={() => { setFocusOpen(false); setConfirmSkipFocus(false); }}
      />
    </>
  );
}
