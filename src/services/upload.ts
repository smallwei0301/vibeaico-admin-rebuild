import { ApiError } from '@/lib/api';
import type { StorageRef } from '@/lib/types';

/**
 * POST /api/upload —— 圖片上傳（07 分冊 §3）。
 *
 * 不能走 `request()`：那支固定送 `Content-Type: application/json`，而本端點收
 * multipart/form-data。所以這裡自己 fetch，但錯誤仍照 `{ success, message, code }`
 * 信封轉成 `ApiError`，呼叫端的處理方式與其他端點一致。
 *
 * 沒有 mock 分支：呼叫端自己決定 mock 模式要不要走到這裡（mock 模式不該有真的
 * 上傳，也不該假裝上傳過）。
 */
export type UploadBucket =
  | 'service-images'
  | 'product-images'
  | 'portfolio-images'
  | 'staff-avatars'
  | 'richmenu-assets'
  | 'chat-images'
  /** 加好友歡迎卡片的圖片（0023；public，去向是 LINE，只收 JPEG/PNG） */
  | 'welcome-card-images'
  /** 關鍵字回覆用的 LINE 圖片（0039；public，僅 JPEG/PNG） */
  | 'keyword-reply-images'
  /** 回報問題的截圖（0019；**private** bucket，url 是短效簽名 URL，見下方 UploadResult） */
  | 'bug-report-attachments';

/** `POST /api/upload` 的回應（route.ts 的 ok({...})）。 */
export type UploadResult = {
  /**
   * 可直接放進 `<img src>` 的網址。
   *
   * ⚠️ **public bucket 是永久網址，private bucket 是短效簽名 URL**
   * （`urlExpiresInSeconds` 秒後失效）。所以 private bucket 的 url
   * **不可以存進資料庫**——存下去只會存出一堆死連結。要保存請存 `path`。
   */
  url: string;
  /** bucket 內路徑 `{tenantId}/{uuid}.{ext}`；要存進資料庫的是這個。 */
  path: string;
  bucket: UploadBucket;
  /** 只有 private bucket 會帶：url 的效期（秒）。 */
  urlExpiresInSeconds?: number;
  /**
   * 只有 `chat-images` 會帶：與原圖一起產出的 **≤1 MB 縮圖**網址／路徑
   * （issue #28 ⑬；LINE image message 的 `previewImageUrl` 上限只有 1 MB，
   * 原圖是 10 MB）。
   *
   * ⚠️ **呼叫端不需要、也不應該把它傳回伺服器**。送 LINE 時的 preview 位置一律由
   * 伺服器端從原圖路徑推導（`src/server/image.ts`），不吃用戶端給的值——那條路徑
   * 只要能被用戶端指定，preview 指向哪裡就不再是我們保證的事。
   * 這兩個欄位存在的意義是**如實說明這次上傳到底產生了幾個物件**：端點多寫了一個
   * 物件卻不講，日後清理的人就看不到它。
   */
  previewUrl?: string;
  previewPath?: string;
  /** 公開物件的持久引用；關鍵字回覆 API 以此驗 tenant ownership 與存在性。 */
  storageRef: StorageRef & { bucket: UploadBucket };
};

/**
 * 上傳一個檔案，拿回 `{ url, path, bucket }`。
 *
 * 需要把上傳結果**存起來**的呼叫端請用這支（例如回報問題的截圖：`bug_reports`
 * 存的是 `attachment_path`，不是會過期的簽名 URL）。只要顯示、且 bucket 是
 * public 的呼叫端可以繼續用 `uploadImage()`。
 */
export async function uploadFile(file: File, bucket: UploadBucket): Promise<UploadResult> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const form = new FormData();
  form.append('file', file);
  form.append('bucket', bucket);

  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  let body: {
    success?: boolean;
    data?: Partial<UploadResult>;
    message?: string;
    code?: string;
  };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }
  if (!res.ok || body.success === false || !body.data?.url || !body.data?.path || !body.data?.storageRef) {
    throw new ApiError(body.message ?? '圖片上傳失敗，請稍後再試', body.code, res.status);
  }
  return {
    url: body.data.url,
    path: body.data.path,
    bucket,
    urlExpiresInSeconds: body.data.urlExpiresInSeconds,
    previewUrl: body.data.previewUrl,
    previewPath: body.data.previewPath,
    storageRef: body.data.storageRef as UploadResult['storageRef'],
  };
}

/** 只要網址的呼叫端（services / products / portfolio / staff / rich-menu）。 */
export async function uploadImage(file: File, bucket: UploadBucket): Promise<string> {
  return (await uploadFile(file, bucket)).url;
}

/* ══════════════════════ Rich Menu 專用的兩支上傳（issue #19 / 06 §6.2.8）
 *
 * ⚠️ 它們**不是** `/api/upload` 的第二份實作：伺服器端三支路由共用同一支
 * `uploadToBucket()`（`src/server/upload.ts`），所以格式檢查、1 MB 上限、
 * MIME 解碼比對完全一致。各自多做的那一件事才是它們存在的理由：
 *   - upload-image      → 順手寫進 `tenant_settings.line.richMenuBgImageUrl`
 *                         （發布端點讀的是那個欄位，不是請求 body）
 *   - upload-cell-icon  → 順手寫進草稿的那一格 `cells[i].icon`
 *
 * 走 fetch 而不是 `request()`，理由同 `uploadFile()`：那支固定送 JSON。
 */

async function postMultipart<T>(path: string, form: FormData, failMessage: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const res = await fetch(`${base}${path}`, { method: 'POST', body: form, credentials: 'include' });

  let body: { success?: boolean; data?: any; message?: string; code?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }
  if (!res.ok || body.success === false || !body.data) {
    throw new ApiError(body.message ?? failMessage, body.code, res.status);
  }
  return body.data as T;
}

/**
 * 上傳選單底圖，並**同時存進店家設定**（發布時真正會被用到的那個欄位）。
 *
 * 這一支取代了頁面原本「`uploadImage()` 再 `saveLineSettings()`」的兩段式做法：
 * 兩段式的中間可能只成功一半——圖進了 bucket、設定沒寫，而畫面已經 toast
 * 「上傳成功」，發布出去的卻還是主題底圖。
 */
export async function uploadRichMenuBackground(
  file: File,
): Promise<{ url: string; path: string; savedTo: string }> {
  const form = new FormData();
  form.append('file', file);
  return postMultipart(
    '/api/settings/line/rich-menu/upload-image', form, '底圖上傳失敗，請稍後再試',
  );
}

/**
 * 上傳某一格的圖示，存進草稿的那一格。
 *
 * ⚠️ 回應的 `composedIntoMenuImage` 恆為 `false`：圖示存得到、讀得回，
 * **但不會出現在 LINE 選單的底圖上**（本專案沒有影像合成能力，`png.ts` 只產純色
 * 矩形，發布上傳的是底圖原圖）。呼叫端必須把這件事寫在使用者讀得到的地方，
 * 不能只顯示「已上傳」——店家會合理預期它出現在選單上（06 分冊 §6.2.8）。
 */
export async function uploadRichMenuCellIcon(
  file: File,
  cellIndex: number,
): Promise<{ url: string; path: string; cellIndex: number; composedIntoMenuImage: boolean }> {
  const form = new FormData();
  form.append('file', file);
  form.append('cellIndex', String(cellIndex));
  return postMultipart(
    '/api/settings/line/rich-menu/upload-cell-icon', form, '圖示上傳失敗，請稍後再試',
  );
}
