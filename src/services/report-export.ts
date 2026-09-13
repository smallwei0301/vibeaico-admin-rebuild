import { adapt } from '@/lib/api';
import {
  NOT_DOWNLOADED,
  downloadAttachment,
  type AttachmentDownloadResult,
} from '@/services/download';
import type { ReportQuery } from '@/services/reports';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type ReportExportFormat = 'csv' | 'excel';

/**
 * 營運報表的檔案下載入口。
 *
 * mock 模式保持 no-op；real 模式只打 canonical `/api/export/reports/:format`。
 * 檔名完全由後端 Content-Disposition 決定，前端不自行拼裝。
 */
export const exportReports = (
  format: ReportExportFormat,
  q: ReportQuery,
) => adapt<AttachmentDownloadResult>(
  () => NOT_DOWNLOADED,
  () => {
    const params = new URLSearchParams({ from: q.from, to: q.to });
    return downloadAttachment(`${API_BASE}/api/export/reports/${format}?${params.toString()}`);
  },
);
