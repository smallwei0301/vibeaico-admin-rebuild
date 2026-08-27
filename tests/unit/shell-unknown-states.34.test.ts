/**
 * 外框「還不知道」時畫面上長什麼樣 — issue #34
 * -----------------------------------------------------------------------------
 * 驗收要求「`setupPercent` 在沒有真實來源時不顯示任何百分比」。這件事只看原始碼
 * 不夠——要看**真的渲染出來的字**。本專案沒有 jsdom（vitest environment: 'node'），
 * 但 `react-dom/server` 的 `renderToStaticMarkup` 在 node 下可用，足以驗
 * 「這個 props 組合會不會印出一個百分比／一個 0」。
 *
 * next/navigation、next/image、Toast 這些只在瀏覽器有意義的相依全部換成假的，
 * 因為本檔要驗的是**文字**，不是路由。
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { common } from '@/i18n/zh-TW/common';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tenant/dashboard',
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('img', { alt: String(props.alt ?? '') }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: () => {} }),
}));
vi.mock('@/services/auth', () => ({ logout: () => Promise.resolve() }));

const TENANT = {
  id: 't_1', shopCode: 'demo', name: '示範店', role: 'OWNER' as const,
  current: true, businessType: 'LOCAL_SHOP' as const,
};

async function renderTopbar(props: { setupPercent: number | null; userName: string | null }) {
  const { Topbar } = await import('@/components/layout/Topbar');
  return renderToStaticMarkup(
    React.createElement(Topbar, {
      onToggleSidebar: () => {},
      tenants: [TENANT],
      currentTenant: TENANT,
      ...props,
    }),
  );
}

async function renderSidebar(counts: Record<string, number> | null) {
  const { Sidebar } = await import('@/components/layout/Sidebar');
  return renderToStaticMarkup(
    React.createElement(Sidebar, {
      collapsed: false, mobileOpen: false, onCloseMobile: () => {},
      counts, businessType: 'LOCAL_SHOP' as const,
    }),
  );
}

describe('Topbar：開店進度沒有真實數字時，不得顯示任何百分比', () => {
  it('setupPercent=null → 顯示「--」與一句說明，畫面上沒有任何百分比數字', async () => {
    const html = await renderTopbar({ setupPercent: null, userName: 'owner@example.com' });

    expect(html).toContain(common.topbar.unknownValue);
    expect(html).toContain(common.topbar.setupProgressUnknown);
    expect(html).toContain(common.topbar.setupProgressUnknownHint);
    // 未知就是未知：不可退回 0%、60% 或任何看起來合理的數字
    expect(html, '未知狀態竟然印出了百分比').not.toMatch(/\d+%/);
  });

  it('setupPercent=60 → 照常顯示 60%（真實來源接上時行為不變）', async () => {
    const html = await renderTopbar({ setupPercent: 60, userName: 'owner@example.com' });
    expect(html).toContain('60%');
    expect(html).not.toContain(common.topbar.setupProgressUnknown);
  });

  it('setupPercent=100 → 整塊收起（既有行為）', async () => {
    const html = await renderTopbar({ setupPercent: 100, userName: 'owner@example.com' });
    expect(html).not.toContain(common.topbar.setupProgress);
  });

  it('userName=null → 顯示「--」，不猜一個名字也不顯示店名', async () => {
    const html = await renderTopbar({ setupPercent: null, userName: null });
    expect(html).toContain(common.topbar.unknownValue);
    expect(html).not.toContain('小威');
  });
});

describe('Sidebar：徽章的「載入中／查到 0／查不到」三態不得互相冒充', () => {
  it('counts=null（還在查）→ 放占位，不畫任何數字', async () => {
    const html = await renderSidebar(null);
    expect(html).toContain(common.badgeLoading);
    expect(html).not.toMatch(/badge-count[^>]*>\d/);
  });

  it('查到 0 → 不畫徽章，也不留占位（0 是「沒有待處理」，是答案）', async () => {
    const html = await renderSidebar({ pendingBookingBadge: 0, unreadChatBadge: 0 });
    expect(html).not.toContain(common.badgeLoading);
    expect(html).not.toMatch(/badge-count/);
  });

  it('查到數字 → 照常畫紅點', async () => {
    const html = await renderSidebar({ pendingBookingBadge: 3 });
    expect(html).toMatch(/badge-count[^>]*>3</);
  });

  it('key 缺席（查不到）→ 什麼都不畫，不冒充 0，也不永遠轉圈', async () => {
    const html = await renderSidebar({});
    expect(html).not.toContain(common.badgeLoading);
    expect(html).not.toMatch(/badge-count/);
  });
});
