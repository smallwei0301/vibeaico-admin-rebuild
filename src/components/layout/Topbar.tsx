'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Building2, ChevronDown, LogOut, Menu, Settings, Smartphone } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { logout } from '@/services/auth';
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
  /**
   * 登入者顯示名稱（real＝`GET /api/auth/me` 的 email，mock＝MOCK_USER.name）。
   * `null` = 還沒問到，此時顯示「--」而不是猜一個名字（issue #34）。
   */
  userName: string | null;
  /**
   * 開店進度百分比（`GET /api/settings/setup-status`）。
   * `null` = 還沒問到／問不到 → 顯示「--」並在同一顆膠囊裡說明，
   * **不得顯示任何百分比數字**（issue #34 的擁有者裁示）。
   */
  setupPercent: number | null;
}) {
  const [shopMenu, setShopMenu] = React.useState(false);
  const [userMenu, setUserMenu] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const router = useRouter();
  const toast = useToast();

  /**
   * 登出（POST /api/auth/logout，03 分冊 §1/§4）。
   *
   * 先前這裡只是一個導去 /tenant/login 的 <Link>：換了頁，httpOnly 的 session
   * cookie 卻還在，直接輸網址就能回到後台——畫面說「登出了」而副作用沒發生，
   * 正是 00 分冊鐵則 12 禁止的假成功。現在改為先 await 後端把 session 失效，
   * 成功才導向登入頁；失敗就留在原地並顯示真正的錯誤訊息，不假裝登出。
   */
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      setUserMenu(false);
      router.replace('/tenant/login');
      router.refresh();   // 清掉 App Router 對已登入頁面的快取
    } catch (e) {
      toast.show(
        `${common.topbar.logoutFailedPrefix}${e instanceof Error ? e.message : common.message.networkError}`,
        'danger',
      );
    } finally {
      setLoggingOut(false);
    }
  };

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

        {/* 進度未知（載入中或取得失敗）→ 顯示「--」並附一句說明；
            已知且未滿 100% → 顯示百分比；已知且 100% → 整塊收起（既有行為）。
            ⚠️ 未知時不可退回 0% 或任何佔位數字（issue #34）。 */}
        {setupPercent === null ? (
          <Link
            href="/tenant/settings"
            title={common.topbar.setupProgressUnknownHint}
            className="hidden items-center gap-2 rounded-pill bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 sm:flex"
          >
            <span className="tabular-nums">{common.topbar.unknownValue}</span>
            <span>{common.topbar.setupProgress}</span>
            <span className="font-normal text-secondary">
              {common.topbar.setupProgressUnknown}
            </span>
          </Link>
        ) : setupPercent < 100 ? (
          <Link
            href="/tenant/settings"
            className="hidden items-center gap-2 rounded-pill bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 sm:flex"
          >
            <span className="tabular-nums">{setupPercent}%</span>
            <span>{common.topbar.setupProgress}</span>
          </Link>
        ) : null}
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
              {tenants.map((t, i) => (
                <React.Fragment key={t.id}>
                  {/* 示範店家排在清單尾端，第一個示範店家前插一條分隔標題，
                      讓使用者一眼看出以下不是自己的店 */}
                  {t.demo && !tenants[i - 1]?.demo ? (
                    <>
                      <hr className="my-1 border-neutral-200" />
                      <div className="px-3 py-2 text-2xs font-bold uppercase text-secondary">
                        {common.topbar.demoShops}
                      </div>
                    </>
                  ) : null}
                  <button
                    onClick={() => { onSwitchTenant?.(t.id); setShopMenu(false); }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-base hover:bg-neutral-100',
                      t.id === currentTenant.id && 'font-semibold text-primary',
                    )}
                  >
                    <Building2 size={15} />
                    <span className="truncate">{t.name}</span>
                    {t.demo ? (
                      <span className="ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-2xs bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]">
                        {common.topbar.demoBadge}
                      </span>
                    ) : null}
                  </button>
                </React.Fragment>
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
            {/* 名字還沒問到就顯示「--」，不要用店名／email 猜一個看起來像人名的字 */}
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {userName ? userName.charAt(0).toUpperCase() : '?'}
            </span>
            <span className="hidden max-w-[12rem] truncate sm:inline">
              {userName ?? common.topbar.unknownValue}
            </span>
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
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => { void handleLogout(); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-danger hover:bg-neutral-100 disabled:opacity-60"
              >
                <LogOut size={15} />
                {common.topbar.logout}
              </button>
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
