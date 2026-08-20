'use client';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** 對應原站 .btn / .btn-primary / .btn-ghost / .btn-sm … */
export const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      success: 'btn-success',
      danger: 'btn-danger',
      warning: 'btn-warning',
      outline: 'btn-outline',
      outlineDanger: 'btn-outline-danger',
      ghost: 'btn-ghost',
      line: 'btn-line',
    },
    size: { sm: 'btn-sm', md: '', lg: 'btn-lg', icon: 'btn-icon' },
    block: { true: 'btn-block' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** loading 時顯示的文案，例如「儲存中...」 */
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, loadingText, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  ),
);
Button.displayName = 'Button';
