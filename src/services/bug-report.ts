/**
 * 問題回報（全站常駐的「回報問題」modal）—— 04 分冊 §B-6。
 *
 * 為什麼要有這支 service：CLAUDE.md「Pages never fetch」規定頁面／版面元件的
 * 唯一資料入口是 src/services/*，元件不得自己 fetch。BugReportModal 先前根本
 * 沒有任何呼叫（setTimeout 假延遲後直接道謝），接線時一併補上這個落點。
 *
 * mock 分支：不打後端，回一個本地假 id。這裡刻意**不**假裝有寫進資料庫——
 * mock 模式整站都沒有後端，回報自然也送不出去，頁面顯示的成功訊息在
 * mock 模式下與其他頁面的 mock 行為一致（見 src/lib/api.ts 的 adapt 說明）。
 */
import { adapt, delay, request } from '@/lib/api';

/** POST /api/bug-report 的 body（與 src/app/api/bug-report/route.ts 的 zod schema 對齊） */
export type BugReportInput = {
  /** 問題類別：BUG / DISPLAY / USABILITY / OTHER（common.bugReport.categories 的 key） */
  category?: string;
  /** 問題標題（bug_reports.subject） */
  subject: string;
  /** 詳細說明（bug_reports.content） */
  content: string;
  /** 回報者自填的回覆信箱（bug_reports.contact_email）；與登入帳號 reporter 不同欄 */
  contactEmail?: string;
  /** 回報當下所在頁面（bug_reports.page_url） */
  pageUrl?: string;
  /**
   * 截圖在 storage 的 bucket 內路徑（bug_reports.attachment_path），
   * 由 `uploadFile(file, 'bug-report-attachments')` 回的 `path` 而來。
   *
   * ⚠️ 這裡刻意是 **path 不是 url**：`bug-report-attachments` 是 private bucket
   * （migration 0019），它的 URL 是短效簽名 URL，存進資料庫只會存出死連結。
   * 端點會再驗一次「路徑屬於本租戶」且「物件真的存在」才寫入。
   */
  attachmentPath?: string;
};

let nextMockId = 1;

export const submitBugReport = (input: BugReportInput) =>
  adapt<{ id: string }>(
    async () => {
      await delay();
      return { id: `br_mock_${nextMockId++}` };
    },
    () => request<{ id: string }>('/api/bug-report', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
