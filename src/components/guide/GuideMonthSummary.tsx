import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideMonthSummaryItem = {
  key: string;
  label: string;
  value: React.ReactNode;
};

export type GuideMonthSummaryProps = React.HTMLAttributes<HTMLElement> & {
  monthLabel: string;
  items: readonly GuideMonthSummaryItem[];
  action?: React.ReactNode;
};

/** A compact month-level summary using caller-provided facts only. */
export function GuideMonthSummary({ monthLabel, items, action, className, ...props }: GuideMonthSummaryProps) {
  return (
    <section className={cn(GUIDE_UI_CLASSES.quietSurface, className)} {...props}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={GUIDE_UI_CLASSES.sectionTitle}>{monthLabel}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {items.length > 0 ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.key} className="min-w-0 rounded-xl bg-white p-3">
              <dt className={GUIDE_UI_CLASSES.secondary}>{item.label}</dt>
              <dd className={cn(GUIDE_UI_CLASSES.cardText, 'mt-1')}>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
