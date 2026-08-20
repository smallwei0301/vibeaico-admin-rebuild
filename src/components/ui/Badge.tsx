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
