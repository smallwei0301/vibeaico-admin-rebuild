import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 頁首 — 對應原站 .page-eyebrow / .page-title / 右側動作區。
 * eyebrow 是 2026-08-01 UX 評審加的：深層頁只有一個 h1，看不出屬於哪個群組。
 */
export function PageHeader({
  eyebrow,
  eyebrowHref,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  eyebrowHref?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="page-eyebrow">
            {eyebrowHref ? (
              <Link href={eyebrowHref} className="text-secondary hover:text-dark">
                {eyebrow}
              </Link>
            ) : (
              <span>{eyebrow}</span>
            )}
            <ChevronRight size={12} />
          </div>
        ) : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
