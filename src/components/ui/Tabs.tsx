'use client';
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabItem = { key: string; label: string; icon?: LucideIcon };

/**
 * 分頁 tabs。
 * ⚠️ 原站踩過的坑保留在此：Bootstrap 的 `.nav-link.active` 是通用 class，
 * 側邊欄的 active 樣式若沒 scope 好會污染這裡的分頁。
 * 本專案側邊欄用 .sidebar-link、分頁用 .tab-link，命名上就切開，不會互相污染。
 */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('tab-nav', className)} role="tablist">
      {items.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={value === t.key}
            data-active={value === t.key}
            className="tab-link"
            onClick={() => onChange(t.key)}
          >
            {Icon ? <Icon size={15} /> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  active,
  children,
  className,
}: {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return <div className={cn('pt-4', className)}>{children}</div>;
}
