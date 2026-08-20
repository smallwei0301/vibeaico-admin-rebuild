'use client';
import * as React from 'react';
import Image from 'next/image';
import { ToastProvider } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';

/**
 * 認證頁版面（登入 / 註冊 / 忘記密碼 / 重設密碼）
 * -----------------------------------------------------------------------------
 * 原站這四頁不吃後台的 AppShell（沒有側邊欄、頂部列、回報問題與客服 widget），
 * 而是「淺灰底 + 置中卡片 + 品牌 logo + 頁尾 copyright」的獨立版面。
 *
 * 為什麼不用 (auth) route group：Next.js 的 route group 只是資料夾分組，
 * `app/(auth)/tenant/login` 與 `app/tenant/*` 會讓同一個 `/tenant` 網址前綴
 * 由兩棵不同的 layout 樹提供，容易踩到路由/佈局衝突。改由 `app/tenant/layout.tsx`
 * 依 pathname 決定套 AppShell 或 AuthShell，網址維持與原站 100% 相同。
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-light">
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-[26rem]">
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <Image
                src="/images/vibeai-logo.png"
                alt={common.brand}
                width={108}
                height={36}
                priority
              />
              <p className="text-xs text-secondary">{common.productTagline}</p>
            </div>
            {children}
          </div>
        </main>
        <footer className="px-4 py-4 text-center text-xs text-secondary">
          {common.copyright}
        </footer>
      </div>
    </ToastProvider>
  );
}

/** 認證卡片內共用的標題區 */
export function AuthCardHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-5 text-center">
      <h1 className="text-xl font-bold text-dark">{title}</h1>
      {description ? <p className="mt-1 text-base text-secondary">{description}</p> : null}
    </div>
  );
}
