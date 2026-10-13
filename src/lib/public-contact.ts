/**
 * 旅客送單後導向狀態頁用的聯絡方式（issue #46）。
 * 先各自 trim，再取第一個非空值；否則「電話只填空白、LINE 有填」會得到空字串，
 * 狀態頁因 `contact` 為空而 404，即使訂單已成功建立。
 * 取到的值必為送出給 API 的（同樣 trim 過的）其中一項，與 loader 比對（trim + 小寫）一致。
 */
export function pickRedirectContact(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const v = (c ?? '').trim();
    if (v) return v;
  }
  return '';
}
