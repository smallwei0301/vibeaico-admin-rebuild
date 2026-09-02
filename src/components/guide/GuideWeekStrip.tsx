'use client';

import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideWeekStripDay = {
  key: string;
  weekdayLabel: string;
  dateLabel: string;
  countLabel?: string;
  ariaLabel?: string;
  selected?: boolean;
  disabled?: boolean;
};

export type GuideWeekStripProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onSelect'> & {
  days: readonly GuideWeekStripDay[];
  onSelect?: (key: string) => void;
};

/** Seven-day GUIDE summary strip; exact date/count values come from real caller data. */
export function GuideWeekStrip({ days, onSelect, className, ...props }: GuideWeekStripProps) {
  return (
    <div className={cn(GUIDE_UI_CLASSES.weekGrid, className)} {...props}>
      {days.map((day) => {
        const accessibleLabel = day.ariaLabel
          ?? [day.weekdayLabel, day.dateLabel, day.countLabel].filter(Boolean).join('，');

        const content = (
          <>
            <span className={GUIDE_UI_CLASSES.weekdayLabel}>{day.weekdayLabel}</span>
            <span className={cn(GUIDE_UI_CLASSES.weekDate, 'mt-1')}>{day.dateLabel}</span>
            {day.countLabel ? <span className={GUIDE_UI_CLASSES.weekCount}>{day.countLabel}</span> : null}
          </>
        );
        const className = cn(
          GUIDE_UI_CLASSES.touchTarget,
          GUIDE_UI_CLASSES.focusRing,
          'flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center',
          day.selected ? GUIDE_UI_CLASSES.calendarDayActive : GUIDE_UI_CLASSES.calendarDayIdle,
        );

        return onSelect ? (
          <button
            key={day.key}
            type="button"
            disabled={day.disabled}
            aria-label={accessibleLabel}
            aria-pressed={day.selected}
            onClick={() => onSelect(day.key)}
            className={cn(className, 'disabled:cursor-not-allowed disabled:opacity-40')}
          >
            {content}
          </button>
        ) : (
          <div
            key={day.key}
            aria-current={day.selected ? 'date' : undefined}
            className={className}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
