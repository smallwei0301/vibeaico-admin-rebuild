import * as React from 'react';

import { GUIDE_UI_CLASSES, type GuideStatusTone } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

import { GuideStatusPill } from './GuideStatusPill';

export type GuideDepartureCardProps = React.HTMLAttributes<HTMLElement> & {
  title: string;
  dateLabel: string;
  timeLabel?: string;
  capacityLabel?: string;
  staffLabel?: string;
  statusLabel: string;
  statusTone?: GuideStatusTone;
  action?: React.ReactNode;
};

/** Compact GUIDE departure summary. Values are supplied by the caller; no demo numbers are invented. */
export function GuideDepartureCard({
  title,
  dateLabel,
  timeLabel,
  capacityLabel,
  staffLabel,
  statusLabel,
  statusTone = 'neutral',
  action,
  className,
  ...props
}: GuideDepartureCardProps) {
  const details = [dateLabel, timeLabel, capacityLabel, staffLabel].filter(Boolean);

  return (
    <article className={cn(GUIDE_UI_CLASSES.card, GUIDE_UI_CLASSES.cardPadding, className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={cn(GUIDE_UI_CLASSES.cardText, 'truncate')}>{title}</h3>
          <div className={cn(GUIDE_UI_CLASSES.secondary, 'mt-2 flex flex-wrap gap-x-3 gap-y-1')}>
            {details.map((detail) => <span key={String(detail)}>{detail}</span>)}
          </div>
        </div>
        <GuideStatusPill tone={statusTone}>{statusLabel}</GuideStatusPill>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </article>
  );
}
