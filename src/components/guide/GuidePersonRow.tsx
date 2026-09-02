import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuidePersonRowProps = React.HTMLAttributes<HTMLDivElement> & {
  name: string;
  subtitle?: string;
  meta?: React.ReactNode;
  avatar?: React.ReactNode;
  trailing?: React.ReactNode;
};

/** Low-density person row for travelers and guides; long labels truncate without shrinking touch UI. */
export function GuidePersonRow({
  name,
  subtitle,
  meta,
  avatar,
  trailing,
  className,
  ...props
}: GuidePersonRowProps) {
  const fallback = name.trim().slice(0, 1) || '•';

  return (
    <div className={cn('flex min-w-0 items-center gap-3 py-3', className)} {...props}>
      <div
        className={cn(
          GUIDE_UI_CLASSES.avatarSurface,
          'flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-[16px] font-bold',
        )}
        aria-hidden
      >
        {avatar ?? fallback}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(GUIDE_UI_CLASSES.body, 'truncate font-semibold')}>{name}</p>
        {subtitle ? <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-0.5 truncate')}>{subtitle}</p> : null}
        {meta ? <div className="mt-1.5">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
