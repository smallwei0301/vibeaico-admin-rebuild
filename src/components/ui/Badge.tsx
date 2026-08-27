import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * 狀態徽章 — 原站用「淺色實心底 + 深色字」而非半透明，
 * 確保疊在斑馬紋/hover 列上仍然清晰。
 */
export const badgeVariants = cva('badge', {
  variants: {
    tone: {
      primary: 'badge-primary',
      success: 'badge-success',
      warning: 'badge-warning',
      danger: 'badge-danger',
      info: 'badge-info',
      purple: 'badge-purple',
      neutral: 'badge-neutral',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** 側邊欄 / 分頁上的紅色數字圓標 */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn('badge badge-count', className)}>{count > 99 ? '99+' : count}</span>
  );
}

/**
 * 「還在查」的徽章占位（issue #34）。
 *
 * 為什麼需要它：徽章只有 `count > 0` 才會出現，所以「載入中」與「查到 0 筆」
 * 在畫面上長得一模一樣。0 是一個有意義的答案（沒有待處理），拿它當「還不知道」
 * 會誤導——這與 issue #17 抓到的「明細還在載入卻寫『無資料』」是同一個病。
 * 因此查詢期間放一顆灰色的「…」，查完才換成真的數字（或什麼都不放）。
 */
export function CountBadgeLoading({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn('badge badge-count bg-neutral-400 opacity-70', className)}
    >
      …
    </span>
  );
}
