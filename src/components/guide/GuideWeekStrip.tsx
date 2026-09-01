'use client';

import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideWeekStripDay = {
  key: string;
  weekdayLabel: string;
  dateLabel: string;
  countLabel?: string;
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
    <div className={cn('grid grid-cols-7 gap-0.5', className)} {...props}>
      {days.map((day) => (
        <button
          key={day.key}
          type="button"
          disabled={day.disabled}
          aria-pressed={day.selected}
          onClick={() => onSelect?.(day.key)}
          className={cn(
            GUIDE_UI_CLASSES.touchTarget,
            'flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center',
            'disabled:cursor-not-allowed disabled:opacity-40',
            day.selected ? GUIDE_UI_CLASSES.calendarDayActive : GUIDE_UI_CLASSES.calendarDayIdle,
          )}
        >
          <span className="text-[14px] font-semibold leading-none">{day.weekdayLabel}</span>
          <span className="mt-1 text-[16px] font-bold leading-none">{day.dateLabel}</span>
          {day.countLabel ? <span className="mt-1 truncate text-[14px] leading-none">{day.countLabel}</span> : null}
        </button>
      ))}
    </div>
  );
}
