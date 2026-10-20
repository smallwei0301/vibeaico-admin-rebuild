/**
 * 公開頁輸出邊界共用的純函式（無 server-only 依賴，client 也可 import）。
 * 原本住在 src/server/public-shop.ts，#753 抽出，讓「複製行程」與公開詳情 loader 套用同一套 URL 過濾。
 */

/** 公開 URL 字元上限；超過一律丟棄。 */
export const MAX_PUBLIC_URL_CHARS = 2048;

export function safePublicHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  // 超過 2048 字元的 URL 一律丟棄（不輸出）。
  if (value.trim().length > MAX_PUBLIC_URL_CHARS) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function publicStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim()).filter(Boolean);
}
