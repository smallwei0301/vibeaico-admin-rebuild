'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { common } from '@/i18n/zh-TW/common';

/**
 * 資料表格容器 — 對應原站 .data-table-container / -header / -body / -footer。
 * 原站的兩個關鍵決策保留在這裡：
 *  1. 表頭 sticky 吸頂（掛在可捲動的 .data-table-body 上）
 *  2. 列底色統一由 --row-bg 變數供色，避免 hover 時出現雙色接縫
 */
export function DataTableContainer({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('data-table-container', className)} {...p} />;
}

export function DataTableHeader({
  title,
  actions,
  className,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('data-table-header', className)}>
      {title ? <h6 className="data-table-title">{title}</h6> : <span />}
      {actions ? <div className="data-table-actions">{actions}</div> : null}
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  /** 金額 / 數量欄：右對齊 + tabular-nums */
  numeric?: boolean;
  width?: string;
  /** 固定於表格右側（橫向捲動時不離開視窗）；未設定時欄位行為完全不變。 */
  sticky?: 'right';
  render: (row: T, index: number) => React.ReactNode;
};

/** 只在欄位設定 sticky 時才回傳樣式 class（樣式定義於 globals.css）。 */
export function stickyClass(c: { sticky?: 'right' }, cell: 'th' | 'td'): string | undefined {
  if (c.sticky !== 'right') return undefined;
  return cell === 'th' ? 'col-sticky-right col-sticky-right-head' : 'col-sticky-right';
}

/** sticky right 欄的「前一欄」才回傳 class（手機版預留空間，避免被固定欄蓋住）；表格沒有 sticky 欄時永遠 undefined。 */
export function beforeStickyClass(columns: { sticky?: 'right' }[], index: number): string | undefined {
  return columns[index + 1]?.sticky === 'right' ? 'col-before-sticky-right' : undefined;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty,
  rowKey,
  scroll,
  rowId,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: React.ReactNode;
  rowKey: (row: T, index: number) => string;
  /** 超長清單給捲動容器 65vh 高度上限（僅桌機），避免頁尾永遠在視窗外 */
  scroll?: boolean;
  /** 可選：為每列加上 DOM id（例如收件匣 deep link 捲動定位）。 */
  rowId?: (row: T) => string | undefined;
  /** 可選：為每列加上 className（例如標示被定位的列）。 */
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <div className={cn('data-table-body', scroll && 'lg:max-h-[65vh] lg:overflow-y-auto')}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c, ci) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}
                  className={cn(c.numeric && 'text-right', stickyClass(c, 'th'), beforeStickyClass(columns, ci))}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="!max-w-none py-8 text-center text-muted">
                {common.loading}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="!max-w-none p-0">
                {empty ?? <div className="py-10 text-center text-muted">{common.noData}</div>}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)} id={rowId?.(row)} className={rowClassName?.(row)}>
                {columns.map((c, ci) => (
                  <td key={c.key} className={cn(c.numeric && 'cell-numeric', stickyClass(c, 'td'), beforeStickyClass(columns, ci))}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DataTableFooter({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('data-table-footer', className)} {...p} />;
}
