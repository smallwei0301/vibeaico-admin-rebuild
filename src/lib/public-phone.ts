/**
 * 公開電話：顯示字串保留原樣（trim 後最多 40 字元，以 code point 計），撥號連結另用 phoneHref。
 * phoneHref 只在「可安全撥號」時輸出：過濾後只剩數字與 +、長度 1–20，且原字串沒有分機標記。
 * 分機標記 regex：`#`、`＃`、`*`、`ext`／`ext.`／`extension`（不分大小寫）、`x` 後接數字、`轉`、`分機`、`分机`。
 * 有分機時 tel: 連結會把分機黏成錯誤號碼，所以 phoneHref 為空字串，只顯示文字。
 */
export const MAX_PUBLIC_PHONE_DISPLAY_CHARS = 40;
export const MAX_PUBLIC_PHONE_HREF_CHARS = 20;
const EXTENSION_MARKER = /[#＃*]|ext\.?|extension|\bx\s*\d|轉|分機|分机/i;

export function buildPublicPhone(raw: string): { phone: string; phoneHref: string } {
  const trimmed = raw.trim();
  const phone = Array.from(trimmed).slice(0, MAX_PUBLIC_PHONE_DISPLAY_CHARS).join('');
  if (!phone || EXTENSION_MARKER.test(trimmed)) return { phone, phoneHref: '' };
  const digits = trimmed.replace(/[^\d+]/g, '');
  const ok = digits.length > 0 && digits.length <= MAX_PUBLIC_PHONE_HREF_CHARS;
  return { phone, phoneHref: ok ? digits : '' };
}

export type PhoneContact =
  | { kind: 'link'; href: string }
  | { kind: 'text' }
  | { kind: 'none' };

/**
 * client 如何呈現電話：phoneHref 有值 → 撥號連結；phoneHref 為空字串 → 只顯示純文字；
 * phoneHref 未提供（店家首頁沿用舊資料形狀）→ 維持原行為（由 phone 過濾出撥號號碼）。
 */
export function phoneContact(shop: { phone: string; phoneHref?: string }): PhoneContact {
  if (!shop.phone) return { kind: 'none' };
  if (shop.phoneHref === undefined) return { kind: 'link', href: shop.phone.replace(/[^\d+]/g, '') };
  return shop.phoneHref ? { kind: 'link', href: shop.phoneHref } : { kind: 'text' };
}
