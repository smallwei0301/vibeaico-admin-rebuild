import { ApiError } from './api';

/**
 * 匯出端點的檔案下載（issue #28 ③④⑤ 共用）
 * -----------------------------------------------------------------------------
 * `/api/export/*` **不走 `{ success, data }` 信封**，成功時直接回檔案位元組
 * （見各 route 檔頭）。所以這裡不能用 `request()`，得自己 fetch。
 *
 * ## 為什麼不是 `window.location.assign(url)`
 *
 * 導頁式下載寫起來只有一行，但呼叫端拿不到任何回應——**不知道成功了沒，
 * 也不知道檔名是什麼**。先前三頁的匯出鈕就是在這個空缺上長出假成功的：
 * 顧客頁 toast「顧客匯出成功 顧客名單_20260825.xlsx」、庫存頁
 * 「異動記錄匯出成功 庫存異動_20260825.csv」——那兩個檔名是前端用當天日期
 * **自己組出來的字串**，與伺服器真正送出的檔名（`customers-2026-08-25.csv`）
 * 既不同名也不同副檔名，而且根本沒有任何檔案被下載。
 *
 * 所以檔名一律**只能**來自伺服器的 `Content-Disposition`：那是唯一知道
 * 檔案真正叫什麼的一方。前端不得自組，也不得在拿不到時填一個看起來合理的值
 * （CLAUDE.md「Never fabricate a known」）。
 *
 * ## 失敗要看得見
 *
 * fetch 讀得到狀態碼，403（未訂閱功能）／401（登入過期）會照 `{ success,
 * message, code }` 信封轉成 `ApiError`，由頁面顯示伺服器原文。導頁式下載
 * 遇到這些狀況只會把一段 JSON 直接畫在瀏覽器上，使用者莫名其妙離開後台。
 */

/** 一次下載的結果。`fileName` 為空＝伺服器沒給檔名（不編一個）。 */
export type DownloadedFile = {
  /** 檔案位元組真的到了瀏覽器、也真的觸發了存檔。 */
  downloaded: boolean;
  /** 實際存下來的檔名，取自 `Content-Disposition`。 */
  fileName: string;
};

/**
 * 從 `Content-Disposition` 取檔名。
 *
 * 兩種寫法都收（RFC 6266）：
 *   - `filename*=UTF-8''%E9%A0%90%E7%B4%84.csv` —— 有百分比編碼的非 ASCII 檔名，
 *     **優先**（規範要求 `filename*` 存在時忽略 `filename`）
 *   - `filename="bookings-2026-08-25.csv"` / `filename=bookings.csv`
 *
 * 取不到就回空字串——**不是**回一個猜的檔名。
 */
export function fileNameFromContentDisposition(header: string | null | undefined): string {
  if (!header) return '';

  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    const value = extended[1].trim();
    // charset'lang'percent-encoded-value
    const parts = value.split("'");
    const encoded = parts.length >= 3 ? parts.slice(2).join("'") : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return quoted[1];

  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() : '';
}

/**
 * 打一支匯出端點，把回應的位元組存成檔案，回傳**伺服器給的**檔名。
 *
 * 只能在有 `document` 的 client 環境呼叫（三頁都是 `'use client'`）。
 * 失敗一律拋 `ApiError`，呼叫端接住後顯示錯誤 toast——不得吞掉後顯示成功。
 */
export async function downloadAttachment(url: string): Promise<DownloadedFile> {
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) {
    let message = '匯出失敗，請稍後再試';
    let code: string | undefined;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      if (body.message) message = body.message;
      code = body.code;
    } catch {
      /* 錯誤回應不是 JSON（例如反向代理擋掉）：保留預設訊息與狀態碼 */
    }
    throw new ApiError(message, code, res.status);
  }

  const fileName = fileNameFromContentDisposition(res.headers.get('Content-Disposition'));
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  /*
   * 沒有檔名就不設 `download` 屬性，讓瀏覽器自己決定——設成空字串會存成
   * 一個叫「download」的無副檔名檔案，那同樣是在替伺服器編一個檔名。
   */
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  /* 延後移除與回收：理由同 src/lib/qr.ts 的 triggerDataUrlDownload（實測過） */
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  }, 0);

  return { downloaded: true, fileName };
}
