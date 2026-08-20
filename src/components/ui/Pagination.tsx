'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { common } from '@/i18n/zh-TW/common';

/** 原站頁尾：左側「顯示第 X–Y 筆，共 Z 筆」，右側上一頁/下一頁 */
export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min((page + 1) * size, total);
  const lastPage = Math.max(0, Math.ceil(total / size) - 1);

  return (
    <>
      <div className="data-table-info">
        {common.pagination.range(from, to, total)}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={14} />
          {common.pagination.prev}
        </Button>
        <span className="text-xs text-muted">
          {common.pagination.pageOf(page + 1, lastPage + 1)}
        </span>
        <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          {common.pagination.next}
          <ChevronRight size={14} />
        </Button>
      </div>
    </>
  );
}
