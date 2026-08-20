'use client';
import * as React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { BugReportButton } from './BugReportModal';
import { SupportChatWidget } from './SupportChatWidget';
import { ToastProvider } from '@/components/ui/Toast';
import { MOCK_TENANTS, MOCK_SIDEBAR_COUNTS, MOCK_SETUP_STATUS, MOCK_USER } from '@/mock';

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

  const current = MOCK_TENANTS.find((t) => t.current) ?? MOCK_TENANTS[0];

  return (
    <ToastProvider>
      <div className="app-wrapper" data-collapsed={collapsed}>
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          counts={MOCK_SIDEBAR_COUNTS}
        />
        <div className="content-wrapper">
          <Topbar
            onToggleSidebar={toggle}
            tenants={MOCK_TENANTS}
            currentTenant={current}
            userName={MOCK_USER.name}
            setupPercent={MOCK_SETUP_STATUS.percent}
          />
          <main className="content-area">{children}</main>
          <Footer />
        </div>
      </div>
      <BugReportButton />
      <SupportChatWidget />
    </ToastProvider>
  );
}
