import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { common } from '@/i18n/zh-TW/common';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props, children),
}));

const tenant = {
  id: 'tenant-a', shopCode: 'a', name: 'Local shop', role: 'OWNER' as const,
  current: true, businessType: 'LOCAL_SHOP' as const,
};

async function renderTopbar(props: { setupPercent: number | null; userName: string | null }) {
  const { Topbar } = await import('@/components/layout/Topbar');
  return renderToStaticMarkup(React.createElement(Topbar, {
    onToggleSidebar: () => {}, tenants: [tenant], currentTenant: tenant, ...props,
  }));
}

describe('Issue #34 Topbar unknown states', () => {
  it('renders unknown setup as -- without inventing a percentage', async () => {
    const html = await renderTopbar({ setupPercent: null, userName: 'owner-a@test.local' });
    expect(html).toContain(common.topbar.unknownValue);
    expect(html).toContain(common.topbar.setupProgressUnknown);
    expect(html).not.toMatch(/\d+%/);
  });

  it('renders an unknown user as -- rather than a mock or derived name', async () => {
    const html = await renderTopbar({ setupPercent: 100, userName: null });
    expect(html).toContain(common.topbar.unknownValue);
    expect(html).not.toContain('小威');
  });
});
