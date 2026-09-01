'use client';

import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideActionCardProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
};

/** A single, thumb-friendly next action for GUIDE mobile surfaces. */
export const GuideActionCard = React.forwardRef<HTMLButtonElement, GuideActionCardProps>(
  ({ title, description, meta, leading, trailing, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        GUIDE_UI_CLASSES.touchTarget,
        GUIDE_UI_CLASSES.interactiveCard,
        'flex w-full items-center gap-3',
        className,
      )}
      {...props}
    >
      {leading ? <span className="flex shrink-0 items-center justify-center" aria-hidden>{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn(GUIDE_UI_CLASSES.cardText, 'block')}>{title}</span>
        {description ? <span className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1 block')}>{description}</span> : null}
        {meta ? <span className="mt-2 block">{meta}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center justify-center">{trailing}</span> : null}
    </button>
  ),
);

GuideActionCard.displayName = 'GuideActionCard';
