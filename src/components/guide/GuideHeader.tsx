import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
};

/** Mobile-first GUIDE page heading with one clear title and optional contextual action. */
export function GuideHeader({
  title,
  subtitle,
  eyebrow,
  leading,
  action,
  className,
  ...props
}: GuideHeaderProps) {
  return (
    <header className={cn('flex items-start gap-3', className)} {...props}>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className={cn(GUIDE_UI_CLASSES.secondary, 'mb-1 font-semibold')}>{eyebrow}</p>
        ) : null}
        <h1 className={GUIDE_UI_CLASSES.pageTitle}>{title}</h1>
        {subtitle ? <p className={cn(GUIDE_UI_CLASSES.bodyMuted, 'mt-2')}>{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
