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
  render: (row: T, index: number) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty,
  rowKey,
  scroll,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: React.ReactNode;
  rowKey: (row: T, index: number) => string;
  /** 超長清單給捲動容器 65vh 高度上限（僅桌機），避免頁尾永遠在視窗外 */
  scroll?: boolean;
}) {
  return (
    <div className={cn('data-table-body', scroll && 'lg:max-h-[65vh] lg:overflow-y-auto')}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}
                  className={cn(c.numeric && 'text-right')}>
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
              <tr key={rowKey(row, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={cn(c.numeric && 'cell-numeric')}>
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
