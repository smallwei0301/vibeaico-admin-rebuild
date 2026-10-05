'use client';
import * as React from 'react';
import { FormError, FormText } from '@/components/ui/Form';
import { cn } from '@/lib/utils';
import {
  countCodePoints, countVisibleItems, tripListViolation,
  type TripTextField, type TripTextFieldError,
} from '@/lib/trip-field-limits';
import {
  MAX_PUBLIC_LIST_ITEM_CHARS, MAX_PUBLIC_LIST_ITEMS,
  MAX_PUBLIC_LONG_TEXT_CHARS, MAX_PUBLIC_SHORT_TEXT_CHARS,
} from '@/lib/public-trip-limits';
import { tripsPage as t } from '@/i18n/zh-TW/pages/trips';

/** 欄位 → 顯示名稱（儲存失敗摘要與草稿錯誤共用）。 */
export const TRIP_TEXT_FIELD_LABEL: Record<TripTextField, string> = {
  description: t.form.descriptionLabel,
  safetyNotice: t.form.safetyLabel,
  inclusions: t.form.inclusionsLabel,
  exclusions: t.form.exclusionsLabel,
  notices: t.form.noticesLabel,
};

export function tripTextFieldErrorMessage(error: TripTextFieldError): string {
  return t.limits.errors[error.kind](error.limit);
}

/**
 * 欄位下方的計數與上限提示，加上（若有）行內錯誤。
 * 文字欄位顯示「n / 上限」，清單欄位顯示「項目 n / 20，每項最多 300 字」。
 * 計數只是提示：是否擋下儲存由 tripTextFieldErrors 決定，與伺服器同一套規則。
 */
export function TripTextFieldMeta({
  field, value, error,
}: {
  field: TripTextField;
  value: string | readonly string[] | null | undefined;
  error?: TripTextFieldError | null;
}) {
  let counter: string;
  let over: boolean;
  if (!Array.isArray(value)) {
    const limit = field === 'description' ? MAX_PUBLIC_LONG_TEXT_CHARS : MAX_PUBLIC_SHORT_TEXT_CHARS;
    const count = countCodePoints(typeof value === 'string' ? value : '');
    counter = t.limits.textCounter(count, limit);
    over = count > limit;
  } else {
    counter = t.limits.listCounter(countVisibleItems(value as readonly string[]), MAX_PUBLIC_LIST_ITEMS, MAX_PUBLIC_LIST_ITEM_CHARS);
    over = error != null || tripListViolation(value as readonly string[]) !== null;
  }
  return (
    <>
      <FormText className={cn('tabular-nums', over && 'text-danger')}>{counter}</FormText>
      {error ? <FormError role="alert">{tripTextFieldErrorMessage(error)}</FormError> : null}
    </>
  );
}
