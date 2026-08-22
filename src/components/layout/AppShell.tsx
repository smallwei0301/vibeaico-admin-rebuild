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
import { myTenants, switchTenant as switchTenantApi } from '@/services';
import type { TenantSummary } from '@/lib/types';

/** real 模式下清單尚未從 /api/auth/my-tenants 載入完成時的暫用值，避免 current 為 undefined */
const EMPTY_TENANT: TenantSummary = {
  id: '', shopCode: '', name: '', role: 'STAFF', current: true, businessType: 'LOCAL_SHOP',
};

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
    myTenants().then((list) => {
      setRemoteTenants(list);
      const cur = list.find((tt) => tt.current) ?? list[0];
      if (cur) setTenantId(cur.id);
    }).catch(() => {});
  }, []);

  const tenants = USE_MOCK ? MOCK_TENANTS : remoteTenants;
  const current = tenants.find((tt) => tt.id === tenantId) ?? tenants[0] ?? EMPTY_TENANT;
  const businessType = current.businessType ?? 'LOCAL_SHOP';
  if (USE_MOCK) {
    // 骨架模式：切換店家時整份假資料換成該業態的版本（見 src/mock/index.ts）
    applyMockMode(businessType);
  }

  const handleSwitchTenant = (id: string) => {
    if (USE_MOCK) {
      localStorage.setItem('vibeai.tenant.id', id);
      setTenantId(id);
    } else {
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
          <main className="content-area" key={businessType}>{children}</main>
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
