import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideSectionCardProps = React.HTMLAttributes<HTMLElement> & {
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

/**
 * GUIDE mobile-first section card. It deliberately keeps one clear topic per card
 * and preserves large type/padding from the GUIDE responsive baseline.
 */
export function GuideSectionCard({
  title,
  description,
  action,
  className,
  children,
  ...props
}: GuideSectionCardProps) {
  return (
    <section className={cn(GUIDE_UI_CLASSES.card, GUIDE_UI_CLASSES.cardPadding, className)} {...props}>
      {title || description || action ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className={GUIDE_UI_CLASSES.sectionTitle}>{title}</h2> : null}
            {description ? <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1')}>{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
