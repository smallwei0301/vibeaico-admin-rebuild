'use client';
import * as React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { BugReportButton } from './BugReportModal';
import { SupportChatWidget } from './SupportChatWidget';
import { ToastProvider } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { BusinessTypeProvider, CurrentTenantProvider } from './BusinessTypeContext';
import { MOCK_TENANTS, applyMockMode } from '@/mock';
import { USE_MOCK } from '@/config/env';
import { setDemoMode } from '@/lib/api';
import {
  currentUser, getSetupStatus, myTenants, sidebarCounts,
  switchTenant as switchTenantApi, type SidebarCounts,
} from '@/services';
import type { TenantSummary } from '@/lib/types';

/** real 模式下清單尚未從 /api/auth/my-tenants 載入完成時的暫用值，避免 current 為 undefined */
const EMPTY_TENANT: TenantSummary = {
  id: '', shopCode: '', name: '', role: 'STAFF', current: true, businessType: 'LOCAL_SHOP',
};

/**
 * real 模式下附加到店家清單尾端的示範店家（三種業態各一）。
 * 新註冊的店家後台是空的，看不出各頁面實際長什麼樣；選到這裡的任何一家，
 * 整站資料來源會臨時切回 src/mock（見 lib/api.ts 的 setDemoMode）。
 * id 沿用 MOCK_TENANTS 的 t_1/t_2/t_3，與真實店家的 uuid 不會相撞。
 */
const DEMO_TENANTS: TenantSummary[] = MOCK_TENANTS.map((t) => ({
  ...t, current: false, demo: true,
}));
const DEMO_TENANT_IDS = new Set(DEMO_TENANTS.map((t) => t.id));
/** 選到示範店家時記住，重新整理仍停在示範店家（真實店家改由後端 cookie 記） */
const DEMO_TENANT_STORAGE_KEY = 'vibeai.demoTenant.id';

/**
 * 後台版面骨架 — 對應原站 #wrapper > #sidebar + #content-wrapper。
 * 側欄收合狀態存在 localStorage，重新整理後保持。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(localStorage.getItem('vibeai.sidebar.collapsed') === 'true');
  }, []);

  const toggle = () => {
    if (window.innerWidth < 992) {
      setMobileOpen((v) => !v);
    } else {
      setCollapsed((v) => {
        localStorage.setItem('vibeai.sidebar.collapsed', String(!v));
        return !v;
      });
    }
  };

  /**
   * 骨架模式：切換店家即切換業態，方便檢視三種模式的後台差異。
   * 存進 localStorage 讓重新整理／直接開網址時仍保持（真實後端對應
   * switch-tenant 的 cookie，見 03 分冊 §5）。
   */
  // real 模式一開始沒有選定的店家（要等 my-tenants 回來）。這裡**不能**拿
  // MOCK_TENANTS[0] 當預設值：那是示範店家，會讓 real 模式的第一次 render 就落在
  // 示範模式，頁面先抓一輪假資料，接著 my-tenants 回來又切成真店家；更糟的是若
  // 使用者接著點的正好是同一家示範店，current.id 沒變 → main 的 key 沒變 →
  // 頁面不重掛載 → 看起來「點示範店家沒反應／沒東西」。
  const [tenantId, setTenantId] = React.useState(
    USE_MOCK ? (MOCK_TENANTS.find((t) => t.current) ?? MOCK_TENANTS[0]).id : '',
  );

  /**
   * 店家身分是否已定案 —— 定案前不掛載頁面（見下方 <main>）。
   *
   * 為什麼需要這個旗標：<main> 的 key 是 current.id，第一次 render 時
   * real 模式的 my-tenants 還沒回來、current.id 是空字串，等清單回來 id 才變成
   * 真的 tenant id → key 改變 → 整個頁面 subtree 重新掛載 → 使用者填到一半的
   * 表單、開著的確認視窗全部被清空。這不是切換店家，卻長得跟切換店家一模一樣。
   * 把頁面延到 id 定案後才掛，key 從第一次掛載就是最終值，
   * 「切換店家要重新掛載」的行為（下方註解說明的原意）完全保留。
   *
   * mock 模式沒有這段非同步，只需等 localStorage 讀完（同一個 mount effect 內、
   * 不打網路），所以幾乎不會看到載入畫面。
   */
  const [tenantsResolved, setTenantsResolved] = React.useState(false);

  React.useEffect(() => {
    if (!USE_MOCK) return;
    const saved = localStorage.getItem('vibeai.tenant.id');
    if (saved && MOCK_TENANTS.some((t) => t.id === saved)) setTenantId(saved);
    setTenantsResolved(true);
  }, []);

  /** real 模式：店家清單改打 GET /api/auth/my-tenants（mock 模式沿用 MOCK_TENANTS，行為不變） */
  const [remoteTenants, setRemoteTenants] = React.useState<TenantSummary[]>([]);
  React.useEffect(() => {
    if (USE_MOCK) return;
    // 上次停在示範店家就維持在示範店家——這步與 my-tenants 是否成功無關，
    // 放在 .then() 裡的話，帳號還沒有店（403）時連示範店家都選不回來。
    const savedDemo = localStorage.getItem(DEMO_TENANT_STORAGE_KEY);
    if (savedDemo && DEMO_TENANT_IDS.has(savedDemo)) {
      setTenantId(savedDemo);
      // 示範店家的身分不靠網路決定，已經定案 —— 後面 my-tenants 回來只會補上
      // 切換器的清單，不會再改 current，所以不必為了它多等一趟往返。
      setTenantsResolved(true);
    }
    myTenants().then((list) => {
      setRemoteTenants(list);
      if (savedDemo && DEMO_TENANT_IDS.has(savedDemo)) return;
      const cur = list.find((tt) => tt.current) ?? list[0];
      if (cur) setTenantId(cur.id);
    }).catch(() => {
      // 失敗（例如帳號還沒有店、401/403）也要放行：頁面自己會顯示空狀態或導回登入，
      // 卡在載入中只會讓使用者看到一片空白。
    }).finally(() => setTenantsResolved(true));
  }, []);

  const tenants = USE_MOCK ? MOCK_TENANTS : [...remoteTenants, ...DEMO_TENANTS];
  // fallback 只能落在「自己的店」，不能落到示範店家——沒選定時（清單還沒回來、
  // 或帳號真的沒有店）掉進示範模式，會讓真實店家看到假資料。
  const current =
    tenants.find((tt) => tt.id === tenantId)
    ?? (USE_MOCK ? tenants[0] : remoteTenants[0])
    ?? EMPTY_TENANT;
  const businessType = current.businessType ?? 'LOCAL_SHOP';

  // 資料來源的切換必須在 render 期完成（不能放 effect）——頁面元件的 effect 會在
  // 本元件 render 之後才跑，那時 adapt() 讀到的旗標必須已經是正確值。
  const demo = !USE_MOCK && !!current.demo;
  setDemoMode(demo);
  if (USE_MOCK || demo) {
    // 骨架／示範模式：切換店家時整份假資料換成該業態的版本（見 src/mock/index.ts）
    applyMockMode(businessType);
  }

  /**
   * 外框的三個值（issue #34）——先前是三個寫死的 mock 常數，**沒有任何分支**：
   * `counts={MOCK_SIDEBAR_COUNTS}`、`setupPercent={MOCK_SETUP_STATUS.percent}`、
   * `userName={MOCK_USER.name}`。`USE_MOCK=false` 之後它們不會報錯、不會變空，
   * 只是繼續顯示同一組數字，而店家點開一筆待處理預約都沒有。
   *
   * 現在一律走 service 層（`adapt()` 內含 mock／示範店家／real 三條路）：
   *   sidebarCounts() → services/shell.ts → /api/bookings?status=PENDING
   *                                       + /api/product-orders/pending/count
   *                                       + /api/chat/conversations
   *   getSetupStatus() → services/settings.ts → /api/settings/setup-status
   *   currentUser()    → services/auth.ts     → /api/auth/me
   *
   * ⚠️ 初始值一律是 `null`＝「還不知道」，不是 0 也不是 60%。
   * 查失敗時**保持 null**（進度／名稱）或讓該 key 缺席（徽章），不退回假值。
   */
  const [counts, setCounts] = React.useState<SidebarCounts | null>(null);
  const [setupPercent, setSetupPercent] = React.useState<number | null>(null);
  const [userName, setUserName] = React.useState<string | null>(null);

  React.useEffect(() => {
    // 店家身分未定案前不查：real 模式此時 tenantId 還是空字串，
    // 查回來的會是後端 cookie 指到的另一家店，數字會先閃錯的再跳掉。
    if (!tenantsResolved) return;
    let alive = true;
    // 切換店家＝重新查；在查回來之前回到「還不知道」，不可留著上一家店的數字
    setCounts(null);
    setSetupPercent(null);
    setUserName(null);
    void sidebarCounts()
      .then((c) => { if (alive) setCounts(c); })
      // 三支全掛（例如整個離線）：把徽章定在「查不到」（空物件），不是 0
      .catch(() => { if (alive) setCounts({}); });
    void getSetupStatus()
      .then((s) => { if (alive) setSetupPercent(s.percent); })
      .catch(() => { /* 保持 null → Topbar 顯示「--」並說明 */ });
    void currentUser()
      .then((u) => { if (alive) setUserName(u.displayName); })
      .catch(() => { /* 保持 null → Topbar 顯示「--」 */ });
    return () => { alive = false; };
  }, [tenantsResolved, current.id, businessType]);

  const handleSwitchTenant = (id: string) => {
    if (USE_MOCK) {
      localStorage.setItem('vibeai.tenant.id', id);
      setTenantId(id);
    } else if (DEMO_TENANT_IDS.has(id)) {
      // 示範店家純前端，不打 switch-tenant（後端沒有這些店，會 403）。
      localStorage.setItem(DEMO_TENANT_STORAGE_KEY, id);
      setTenantId(id);
    } else {
      localStorage.removeItem(DEMO_TENANT_STORAGE_KEY);
      void switchTenantApi(id).then(() => window.location.reload());
    }
  };

  return (
    <ToastProvider>
     <BusinessTypeProvider value={businessType}>
      <CurrentTenantProvider value={current}>
      <div className="app-wrapper" data-collapsed={collapsed}>
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          counts={counts}
          businessType={businessType}
          extraModules={current.extraModules}
        />
        <div className="content-wrapper">
          <Topbar
            onToggleSidebar={toggle}
            tenants={tenants}
            currentTenant={current}
            onSwitchTenant={handleSwitchTenant}
            userName={userName}
            setupPercent={setupPercent}
          />
          {/* key 用店家 id 而非業態：切到「同業態的示範店家」時業態不變，
              只 key 業態的話頁面不會重掛載、會停在切換前的資料。
              ⚠️ 有 key 就一定要配 tenantsResolved：id 尚未定案就把頁面掛上去，
              「載入中 → 載入完成」會被 key 當成一次店家切換而清空整頁狀態。 */}
          <main className="content-area" key={current.id || businessType}>
            {tenantsResolved
              ? children
              : <div className="py-10 text-center text-muted">{common.loading}</div>}
          </main>
          <Footer />
        </div>
      </div>
      <BugReportButton />
      <SupportChatWidget />
      </CurrentTenantProvider>
     </BusinessTypeProvider>
    </ToastProvider>
  );
}
