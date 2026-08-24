'use client';
import * as React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { BugReportButton } from './BugReportModal';
import { SupportChatWidget } from './SupportChatWidget';
import { ToastProvider } from '@/components/ui/Toast';
import { BusinessTypeProvider, CurrentTenantProvider } from './BusinessTypeContext';
import { MOCK_TENANTS, MOCK_SIDEBAR_COUNTS, MOCK_SETUP_STATUS, MOCK_USER, applyMockMode } from '@/mock';
import { USE_MOCK } from '@/config/env';
import { setDemoMode } from '@/lib/api';
import { myTenants, switchTenant as switchTenantApi } from '@/services';
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
  const [tenantId, setTenantId] = React.useState(
    (MOCK_TENANTS.find((t) => t.current) ?? MOCK_TENANTS[0]).id,
  );

  React.useEffect(() => {
    if (!USE_MOCK) return;
    const saved = localStorage.getItem('vibeai.tenant.id');
    if (saved && MOCK_TENANTS.some((t) => t.id === saved)) setTenantId(saved);
  }, []);

  /** real 模式：店家清單改打 GET /api/auth/my-tenants（mock 模式沿用 MOCK_TENANTS，行為不變） */
  const [remoteTenants, setRemoteTenants] = React.useState<TenantSummary[]>([]);
  React.useEffect(() => {
    if (USE_MOCK) return;
    const savedDemo = localStorage.getItem(DEMO_TENANT_STORAGE_KEY);
    myTenants().then((list) => {
      setRemoteTenants(list);
      // 上次停在示範店家就維持在示範店家，否則回到後端 cookie 指定的那家。
      if (savedDemo && DEMO_TENANT_IDS.has(savedDemo)) {
        setTenantId(savedDemo);
        return;
      }
      const cur = list.find((tt) => tt.current) ?? list[0];
      if (cur) setTenantId(cur.id);
    }).catch(() => {});
  }, []);

  const tenants = USE_MOCK ? MOCK_TENANTS : [...remoteTenants, ...DEMO_TENANTS];
  const current = tenants.find((tt) => tt.id === tenantId) ?? tenants[0] ?? EMPTY_TENANT;
  const businessType = current.businessType ?? 'LOCAL_SHOP';

  // 資料來源的切換必須在 render 期完成（不能放 effect）——頁面元件的 effect 會在
  // 本元件 render 之後才跑，那時 adapt() 讀到的旗標必須已經是正確值。
  const demo = !USE_MOCK && !!current.demo;
  setDemoMode(demo);
  if (USE_MOCK || demo) {
    // 骨架／示範模式：切換店家時整份假資料換成該業態的版本（見 src/mock/index.ts）
    applyMockMode(businessType);
  }

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
          counts={MOCK_SIDEBAR_COUNTS}
          businessType={businessType}
          extraModules={current.extraModules}
        />
        <div className="content-wrapper">
          <Topbar
            onToggleSidebar={toggle}
            tenants={tenants}
            currentTenant={current}
            onSwitchTenant={handleSwitchTenant}
            userName={MOCK_USER.name}
            setupPercent={MOCK_SETUP_STATUS.percent}
          />
          {/* key 用店家 id 而非業態：切到「同業態的示範店家」時業態不變，
              只 key 業態的話頁面不會重掛載、會停在切換前的資料。 */}
          <main className="content-area" key={current.id || businessType}>{children}</main>
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
