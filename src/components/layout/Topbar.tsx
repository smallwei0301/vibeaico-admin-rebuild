'use client';
import * as React from 'react';
import Link from 'next/link';
import { Bell, Building2, ChevronDown, LogOut, Menu, Settings, Smartphone } from 'lucide-react';
import { common } from '@/i18n/zh-TW/common';
import { cn } from '@/lib/utils';
import type { TenantSummary } from '@/lib/types';

/**
 * 頂部列 — 對應原站 .topbar。
 * 左側：漢堡鈕 + 設定進度環；右側：店家切換 + 使用者選單。
 * 手機版 sticky 常駐（原站 2026-08-01 UX 評審：長頁面捲到底要回導航得滑幾十屏）。
 */
export function Topbar({
  onToggleSidebar,
  tenants,
  currentTenant,
  onSwitchTenant,
  userName,
  setupPercent,
}: {
  onToggleSidebar: () => void;
  tenants: TenantSummary[];
  currentTenant: TenantSummary;
  /** 切換目前操作的店家（真實後端對應 POST /api/auth/switch-tenant） */
  onSwitchTenant?: (tenantId: string) => void;
  userName: string;
  setupPercent: number;
}) {
  const [shopMenu, setShopMenu] = React.useState(false);
  const [userMenu, setUserMenu] = React.useState(false);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          aria-label={common.topbar.toggleSidebar}
          className="btn btn-ghost btn-icon"
          onClick={onToggleSidebar}
        >
          <Menu size={20} />
        </button>

        {setupPercent < 100 && (
          <Link
            href="/tenant/settings"
            className="hidden items-center gap-2 rounded-pill bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 sm:flex"
          >
            <span className="tabular-nums">{setupPercent}%</span>
            <span>{common.topbar.setupProgress}</span>
          </Link>
        )}
      </div>

      <div className="topbar-right">
        {/* 店家切換 */}
        <div className="relative">
          <button
            type="button"
            className="btn btn-ghost gap-2"
            onClick={() => { setShopMenu((v) => !v); setUserMenu(false); }}
          >
            <Building2 size={16} />
            <span className="hidden max-w-[10rem] truncate sm:inline">{currentTenant.name}</span>
            <ChevronDown size={14} />
          </button>
          {shopMenu && (
            <DropdownPanel onClose={() => setShopMenu(false)}>
              <div className="px-3 py-2 text-2xs font-bold uppercase text-secondary">
                {common.topbar.myShops}
              </div>
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { onSwitchTenant?.(t.id); setShopMenu(false); }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-base hover:bg-neutral-100',
                    t.id === currentTenant.id && 'font-semibold text-primary',
                  )}
                >
                  <Building2 size={15} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              <hr className="my-1 border-neutral-200" />
              <Link href="/tenant/settings" className="flex items-center gap-2 px-3 py-2 text-base text-neutral-700 hover:bg-neutral-100">
                <Settings size={15} />
                {common.topbar.shopSettings}
              </Link>
            </DropdownPanel>
          )}
        </div>

        {/* 使用者 */}
        <div className="relative">
          <button
            type="button"
            className="btn btn-ghost gap-2"
            onClick={() => { setUserMenu((v) => !v); setShopMenu(false); }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {userName.charAt(0).toUpperCase()}
            </span>
            <span className="hidden sm:inline">{userName}</span>
            <ChevronDown size={14} />
          </button>
          {userMenu && (
            <DropdownPanel onClose={() => setUserMenu(false)}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-neutral-700 hover:bg-neutral-100">
                <Smartphone size={15} />
                {common.topbar.installApp}
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-neutral-700 hover:bg-neutral-100">
                <Bell size={15} />
                {common.topbar.enablePush}
              </button>
              <hr className="my-1 border-neutral-200" />
              <Link href="/tenant/login" className="flex items-center gap-2 px-3 py-2 text-base text-danger hover:bg-neutral-100">
                <LogOut size={15} />
                {common.topbar.logout}
              </Link>
            </DropdownPanel>
          )}
        </div>
      </div>
    </header>
  );
}

function DropdownPanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 z-20 mt-1 min-w-[14rem] rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
        {children}
      </div>
    </>
  );
}
