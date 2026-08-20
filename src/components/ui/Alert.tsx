import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export const alertVariants = cva('alert', {
  variants: {
    tone: {
      primary: 'alert-primary',
      success: 'alert-success',
      warning: 'alert-warning',
      danger: 'alert-danger',
      info: 'alert-info',
      neutral: 'alert-neutral',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const ICONS = {
  primary: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  neutral: Info,
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  icon?: React.ReactNode | false;
  title?: React.ReactNode;
  action?: React.ReactNode;
}

export function Alert({ className, tone, icon, title, action, children, ...props }: AlertProps) {
  const Icon = ICONS[tone ?? 'neutral'];
  return (
    <div className={cn(alertVariants({ tone }), className)} {...props}>
      {icon === false ? null : icon ?? <Icon size={18} className="mt-0.5 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}
