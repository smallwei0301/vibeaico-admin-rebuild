'use client';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { AuthShell } from '@/components/layout/AuthShell';

/**
 * /tenant/* 版面切換
 * -----------------------------------------------------------------------------
 * 原站的登入 / 註冊 / 忘記密碼 / 重設密碼 四頁網址同樣在 /tenant 底下，
 * 但**不套後台版面**（無側邊欄、頂部列、回報問題與 AI 客服 widget）。
 *
 * Next.js 的 route group（例如 app/(auth)/tenant/login）只是資料夾分組，
 * 會讓同一個 /tenant 前綴由兩棵 layout 樹提供，維護時很容易踩到路由衝突；
 * 這裡改成在單一 layout 內依 pathname 分流，網址與原站 100% 相同，
 * 而且「哪些路由不套 AppShell」只有這一份清單，不會散落。
 */
const AUTH_ROUTES = [
  '/tenant/login',
  '/tenant/register',
  '/tenant/forgot-password',
  '/tenant/reset-password',
] as const;

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const isAuthRoute = AUTH_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );

  if (isAuthRoute) return <AuthShell>{children}</AuthShell>;
  return <AppShell>{children}</AppShell>;
}
