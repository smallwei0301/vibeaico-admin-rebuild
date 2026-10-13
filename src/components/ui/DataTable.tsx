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

/**
 * 固定操作欄的 compact 模式遲滯判斷（純函式，可單元測試）。
 * - 非 compact：容器實際橫向溢出（scrollWidth > clientWidth + 1）才進入。
 * - compact：scrollWidth 是 compact 版面的寬度，不能拿來比；改用「進入前（非 compact）量到的 scrollWidth」
 *   當門檻 threshold，容器寬度回到足以容納該寬度（clientWidth + 1 >= threshold）才退出。
 *   進入條件 sw > cw + 1 與退出條件 cw + 1 >= sw 互為補集、門檻固定不隨 compact 狀態改變，
 *   所以同一個寬度不會出現「進入後立刻退出」的來回切換。
 */
export function nextStickyCompact(
  prev: boolean,
  m: { scrollWidth: number; clientWidth: number; threshold: number },
): boolean {
  if (!prev) return m.scrollWidth > m.clientWidth + 1;
  return !(m.clientWidth + 1 >= m.threshold);
}

export const STICKY_COMPACT_ATTR = 'data-sticky-compact';

/**
 * 只在 columns 有 sticky 欄時，依「表格實際是否橫向溢出」切換容器的 data-sticky-compact。
 * 沒有 sticky 欄：不建立 observer、不寫屬性。
 */
function useStickyCompact(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  deps: React.DependencyList,
) {
  const threshold = React.useRef(0); // 進入 compact 前量到的非 compact scrollWidth（退出門檻）
  const lastTableWidth = React.useRef(-1); // 上次評估結束時的表格寬度，用來分辨「內容變了」與「只是自己切換造成的尺寸變化」

  const evaluate = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const table = el.firstElementChild as HTMLElement | null;
    const tableWidth = table ? table.getBoundingClientRect().width : 0;
    const compact = el.hasAttribute(STICKY_COMPACT_ATTR);
    if (compact && Math.abs(tableWidth - lastTableWidth.current) < 0.5) {
      // 表格內容沒變：只靠遲滯門檻判斷是否退出，不動 DOM 就不會閃。
      if (nextStickyCompact(true, { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, threshold: threshold.current })) return;
    }
    // 其餘情形需要「非 compact」的 scrollWidth：暫時移除屬性量測（同一同步段內，瀏覽器不會繪出中間狀態）。
    if (compact) el.removeAttribute(STICKY_COMPACT_ATTR);
    const sw = el.scrollWidth;
    threshold.current = sw;
    const next = nextStickyCompact(false, { scrollWidth: sw, clientWidth: el.clientWidth, threshold: sw });
    if (next) el.setAttribute(STICKY_COMPACT_ATTR, '');
    lastTableWidth.current = table ? table.getBoundingClientRect().width : 0;
  }, [ref]);

  React.useLayoutEffect(() => {
    if (!enabled) return;
    evaluate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, evaluate, ...deps]);

  React.useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => evaluate());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      ro.disconnect();
      el.removeAttribute(STICKY_COMPACT_ATTR);
      lastTableWidth.current = -1;
    };
  }, [enabled, ref, evaluate]);
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
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const hasSticky = columns.some((c) => c.sticky === 'right');
  useStickyCompact(bodyRef, hasSticky, [rows, loading, columns]);
  return (
    <div ref={bodyRef} className={cn('data-table-body', scroll && 'lg:max-h-[65vh] lg:overflow-y-auto')}>
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
