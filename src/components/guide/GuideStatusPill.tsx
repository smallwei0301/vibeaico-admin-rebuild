import * as React from 'react';

import { GUIDE_STATUS_CLASSES, type GuideStatusTone } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideStatusPillProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: GuideStatusTone;
};

/**
 * GUIDE status color is semantic and centralized. Callers choose a tone, not a raw color.
 * Text remains mandatory so color is never the only state signal.
 */
export function GuideStatusPill({ tone = 'neutral', className, children, ...props }: GuideStatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[14px] font-semibold leading-none',
        GUIDE_STATUS_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
