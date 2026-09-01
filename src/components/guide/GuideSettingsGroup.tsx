import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideSettingsGroupProps = React.HTMLAttributes<HTMLElement> & {
  title: string;
  description?: string;
};

/** Progressive-disclosure container for GUIDE secondary settings under the More parent. */
export function GuideSettingsGroup({ title, description, className, children, ...props }: GuideSettingsGroupProps) {
  return (
    <section className={cn(GUIDE_UI_CLASSES.card, 'overflow-hidden', className)} {...props}>
      <header className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <h2 className={GUIDE_UI_CLASSES.sectionTitle}>{title}</h2>
        {description ? <p className={cn(GUIDE_UI_CLASSES.secondary, 'mt-1')}>{description}</p> : null}
      </header>
      <div className={cn(GUIDE_UI_CLASSES.divider, 'divide-y border-t')}>{children}</div>
    </section>
  );
}
