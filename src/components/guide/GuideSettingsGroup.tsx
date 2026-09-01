import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

import { ChevronDown } from 'lucide-react';

export type GuideSettingsGroupProps = React.HTMLAttributes<HTMLElement> & {
  title: string;
  description?: string;
  defaultOpen?: boolean;
};

/** Progressive-disclosure container for GUIDE secondary settings under the More parent. */
export function GuideSettingsGroup({
  title,
  description,
  defaultOpen = false,
  className,
  children,
  ...props
}: GuideSettingsGroupProps) {
  const headingId = React.useId();

  return (
    <details
      className={cn(GUIDE_UI_CLASSES.card, 'overflow-hidden', className)}
      defaultOpen={defaultOpen}
      {...props}
    >
      <summary
        className={cn(
          GUIDE_UI_CLASSES.detailsSummary,
          GUIDE_UI_CLASSES.focusRing,
          'group flex items-center justify-between gap-3 text-left',
        )}
      >
        <span id={headingId} className={GUIDE_UI_CLASSES.sectionTitle} role="heading" aria-level={2}>
          {title}
        </span>
        <ChevronDown size={20} className="shrink-0" aria-hidden />
      </summary>
      <section aria-labelledby={headingId}>
        {description ? (
          <p className={cn(GUIDE_UI_CLASSES.secondary, 'px-4 pb-3 sm:px-5')}>{description}</p>
        ) : null}
        <div className={cn(GUIDE_UI_CLASSES.divider, 'divide-y border-t')}>{children}</div>
      </section>
    </details>
  );
}
