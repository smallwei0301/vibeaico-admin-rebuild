/**
 * LINE 憑證格式警告的共用規則（#982）。
 * 一律先 trim 再判斷：複製貼上常帶前後空白／換行，存檔時也是送 trim 後的值。
 * 只回傳警告種類代碼，文案由各頁依 i18n 組出。
 */

export const CHANNEL_SECRET_LENGTH = 32;
export const ACCESS_TOKEN_MIN_LENGTH = 100;

export const isUrlLike = (v: string) => /^https?:\/\//i.test(v.trim());

export type LineChannelIdWarning = { kind: 'url' } | { kind: 'notNumber' } | null;
export type LineLengthWarning = { kind: 'url' } | { kind: 'tooShort'; length: number } | null;

export function lineChannelIdWarning(value: string): LineChannelIdWarning {
  const v = value.trim();
  if (!v) return null;
  if (isUrlLike(v)) return { kind: 'url' };
  if (!/^\d+$/.test(v)) return { kind: 'notNumber' };
  return null;
}

function lengthWarning(value: string, editing: boolean, minLength: number): LineLengthWarning {
  if (!editing) return null;
  const v = value.trim();
  // 空字串＝保留原值，不警告
  if (!v) return null;
  if (isUrlLike(v)) return { kind: 'url' };
  if (v.length < minLength) return { kind: 'tooShort', length: v.length };
  return null;
}

export const lineSecretWarning = (value: string, editing: boolean): LineLengthWarning =>
  lengthWarning(value, editing, CHANNEL_SECRET_LENGTH);

export const lineTokenWarning = (value: string, editing: boolean): LineLengthWarning =>
  lengthWarning(value, editing, ACCESS_TOKEN_MIN_LENGTH);

/**
 * 儲存後 Secret／Token 是否都會存在（#1003）。
 * 重新輸入（editing 且 trim 後非空）或已存有遮罩值皆算存在；空字串＝保留原值，不會補上缺少的值。
 */
export function lineCredentialPresence(args: {
  existingSecret: string | null | undefined;
  existingToken: string | null | undefined;
  secretEditing: boolean;
  secretInput: string;
  tokenEditing: boolean;
  tokenInput: string;
}): { hasSecret: boolean; hasToken: boolean; missing: boolean } {
  const hasSecret = args.secretEditing ? !!args.secretInput.trim() || !!args.existingSecret : !!args.existingSecret;
  const hasToken = args.tokenEditing ? !!args.tokenInput.trim() || !!args.existingToken : !!args.existingToken;
  return { hasSecret, hasToken, missing: !hasSecret || !hasToken };
}
