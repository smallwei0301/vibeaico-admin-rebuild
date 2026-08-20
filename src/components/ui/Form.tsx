'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function FormGroup({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4', className)} {...p} />;
}

export function Label({
  required,
  className,
  children,
  ...p
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('form-label', required && 'form-required', className)} {...p}>
      {children}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn('form-control', className)} {...p} />,
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn('form-control', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { options?: { value: string; label: string }[] }
>(({ className, options, children, ...p }, ref) => (
  <select ref={ref} className={cn('form-select', className)} {...p}>
    {options
      ? options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))
      : children}
  </select>
));
Select.displayName = 'Select';

export function FormText({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('form-text', className)} {...p} />;
}

export function FormError({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('form-error', className)} {...p} />;
}

/** 字數計數器：原站多處出現「0 /500」 */
export function CharCounter({ value, max }: { value: string; max: number }) {
  return (
    <span className={cn('form-text tabular-nums', value.length > max && 'text-danger')}>
      {value.length} / {max}
    </span>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked}
      className="form-switch disabled:opacity-50"
      onClick={() => onCheckedChange(!checked)}
    />
  );
}

/** 開關 + 標題 + 說明的組合，settings / line-settings 全頁重複使用 */
export function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-base font-semibold text-neutral-800">{label}</div>
        {description ? <div className="form-text">{description}</div> : null}
        {checked && children ? <div className="mt-3">{children}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
