import type { Metadata } from 'next';
import '@/styles/globals.css';
import { common } from '@/i18n/zh-TW/common';

export const metadata: Metadata = {
  title: { default: `${common.brandFull}`, template: `%s | ${common.brandFull}` },
  description: '免費線上預約系統，整合 LINE 預約機器人。管理您的預約、顧客、員工和營運報表。',
  themeColor: '#4361ee',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: common.brand },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
