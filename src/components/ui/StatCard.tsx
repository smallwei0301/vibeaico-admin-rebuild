import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 儀表板統計卡。
 * 原站 2026-08-01 UX 評審拿掉了裝飾性四色左邊框：
 * 「數字本身才是重點，色條不承載語意只會分散注意力。」
 * 顏色只留在 icon 上。
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  hint?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    primary: 'bg-[var(--badge-primary-bg)] text-[var(--badge-primary-fg)]',
    success: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
    warning: 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]',
    danger: 'bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]',
    info: 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]',
    neutral: 'bg-neutral-200 text-neutral-700',
  }[tone];

  return (
    <div className={cn('stat-card', className)}>
      <div className="min-w-0">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint ? <div className="form-text">{hint}</div> : null}
      </div>
      {Icon ? (
        <div className={cn('stat-icon', toneClass)}>
          <Icon size={20} />
        </div>
      ) : null}
    </div>
  );
}
