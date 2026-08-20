import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 貨幣格式：原站一律 NT$ + 千分位，無小數 */
export function formatCurrency(n: number): string {
  return `NT$${Math.round(n).toLocaleString('zh-TW')}`;
}

/** 數字千分位（表格右對齊時搭配 tabular-nums） */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-TW');
}

export function formatPercent(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

/** 2026/08/20 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 2026/08/20 14:30 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 14:30 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const WEEKDAYS_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export function weekdayZh(iso: string): string {
  return WEEKDAYS_ZH[new Date(iso).getDay()];
}
