import * as React from 'react';

import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import { cn } from '@/lib/utils';

export type GuideBottomNavItem = {
  key: string;
  label: string;
  href: string;
  icon?: React.ReactNode;
  active?: boolean;
};

export type GuideBottomNavProps = React.HTMLAttributes<HTMLElement> & {
  items: readonly GuideBottomNavItem[];
};

/**
 * GUIDE mobile parent navigation. Phase B supplies the canonical five destinations;
 * this primitive only renders real links and safe-area spacing.
 */
export function GuideBottomNav({ items, className, ...props }: GuideBottomNavProps) {
  return (
    <nav
      aria-label="GUIDE primary"
      className={cn(
        GUIDE_UI_CLASSES.navShell,
        'fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur pb-[max(env(safe-area-inset-bottom),8px)]',
        className,
      )}
      {...props}
    >
      <div className="mx-auto grid min-h-[64px] max-w-3xl grid-flow-col auto-cols-fr px-2">
        {items.map((item) => (
          <a
            key={item.key}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              GUIDE_UI_CLASSES.touchTarget,
              GUIDE_UI_CLASSES.focusRing,
              'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[14px] font-semibold leading-tight',
              item.active ? GUIDE_UI_CLASSES.navActive : GUIDE_UI_CLASSES.navInactive,
            )}
          >
            {item.icon ? <span aria-hidden>{item.icon}</span> : null}
            <span className="max-w-full break-words whitespace-normal">{item.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
