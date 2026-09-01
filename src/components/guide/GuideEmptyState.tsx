import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideEmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
};

/** Truthful no-data state. It never fabricates counts, examples, people or itinerary data. */
export function GuideEmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: GuideEmptyStateProps) {
  return (
    <div
      className={cn(GUIDE_UI_CLASSES.quietSurface, 'flex flex-col items-center text-center', className)}
      {...props}
    >
      {icon ? (
        <div className={cn(GUIDE_UI_CLASSES.avatarSurface, 'mb-3 flex size-11 items-center justify-center rounded-full')} aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className={GUIDE_UI_CLASSES.cardText}>{title}</p>
      {description ? <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1.5 max-w-md')}>{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
