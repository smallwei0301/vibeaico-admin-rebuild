import {
  MAX_PUBLIC_LIST_ITEM_CHARS, MAX_PUBLIC_LIST_ITEMS,
  MAX_PUBLIC_LONG_TEXT_CHARS, MAX_PUBLIC_SHORT_TEXT_CHARS,
} from '@/lib/public-trip-limits';

/** Match public text clipping's Unicode code-point count, without changing the submitted text. */
export function withinTripTextLimit(value: string, maxCodePoints: number): boolean {
  let count = 0;
  for (const _char of value) {
    if (++count > maxCodePoints) return false;
  }
  return true;
}

export type TripListViolation = 'tooManyItems' | 'itemTooLong';

/**
 * Public list semantics: ignore blank items and count each trimmed item's code points.
 * 回傳違規種類（項數優先於單項過長），沒有違規回傳 null；伺服器與後台 UI 共用這一份判斷。
 */
export function tripListViolation(items: readonly string[]): TripListViolation | null {
  let count = 0;
  let itemTooLong = false;
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    count += 1;
    if (!withinTripTextLimit(text, MAX_PUBLIC_LIST_ITEM_CHARS)) itemTooLong = true;
  }
  if (count > MAX_PUBLIC_LIST_ITEMS) return 'tooManyItems';
  return itemTooLong ? 'itemTooLong' : null;
}

export function withinTripListLimits(items: readonly string[]): boolean {
  return tripListViolation(items) === null;
}

/** `includes` is the newline-delimited transport for the UI's `inclusions` list. */
export function withinTripIncludesLimits(value: string): boolean {
  return withinTripListLimits(value.split(/\r?\n/));
}

/* ------------------------------------------------------------------------- 後台 UI 共用（client-safe） */

/** Unicode code point 數（emoji 等 surrogate pair 算 1），與伺服器上限用同一種算法。 */
export function countCodePoints(value: string): number {
  let count = 0;
  for (const _char of value) count += 1;
  return count;
}

/** 計入上限的項數：trim 後非空白的項目。 */
export function countVisibleItems(items: readonly string[]): number {
  return items.reduce((n, item) => (item.trim() ? n + 1 : n), 0);
}

export type TripTextField = 'description' | 'safetyNotice' | 'inclusions' | 'exclusions' | 'notices';

export const TRIP_TEXT_FIELDS: readonly TripTextField[] = [
  'description', 'safetyNotice', 'inclusions', 'exclusions', 'notices',
];

export type TripTextFieldError =
  | { field: 'description' | 'safetyNotice'; kind: 'tooLong'; limit: number }
  | { field: 'inclusions' | 'exclusions' | 'notices'; kind: 'tooManyItems' | 'itemTooLong'; limit: number };

export type TripTextFields = {
  description?: string;
  safetyNotice?: string;
  inclusions?: string[];
  exclusions?: string[];
  notices?: string[];
};

/**
 * 只檢查「有出現」的欄位（undefined 視為沒送，不檢查）。規則與伺服器寫入邊界相同：
 * description 5000、safetyNotice（server 的 notes）2000 code points；
 * 三個清單最多 20 個非空白項、每項 trim 後最多 300 code points。
 * inclusions 以 `join('\n')` 經 withinTripIncludesLimits 判斷，等同伺服器收到的 `includes`。
 */
export function tripTextFieldErrors(fields: TripTextFields): TripTextFieldError[] {
  const errors: TripTextFieldError[] = [];
  if (typeof fields.description === 'string' && !withinTripTextLimit(fields.description, MAX_PUBLIC_LONG_TEXT_CHARS)) {
    errors.push({ field: 'description', kind: 'tooLong', limit: MAX_PUBLIC_LONG_TEXT_CHARS });
  }
  if (typeof fields.safetyNotice === 'string' && !withinTripTextLimit(fields.safetyNotice, MAX_PUBLIC_SHORT_TEXT_CHARS)) {
    errors.push({ field: 'safetyNotice', kind: 'tooLong', limit: MAX_PUBLIC_SHORT_TEXT_CHARS });
  }
  if (Array.isArray(fields.inclusions) && !withinTripIncludesLimits(fields.inclusions.join('\n'))) {
    const kind = tripListViolation(fields.inclusions.join('\n').split(/\r?\n/));
    if (kind) errors.push({ field: 'inclusions', kind, limit: kind === 'tooManyItems' ? MAX_PUBLIC_LIST_ITEMS : MAX_PUBLIC_LIST_ITEM_CHARS });
  }
  for (const field of ['exclusions', 'notices'] as const) {
    const items = fields[field];
    if (!Array.isArray(items)) continue;
    const kind = tripListViolation(items);
    if (kind) errors.push({ field, kind, limit: kind === 'tooManyItems' ? MAX_PUBLIC_LIST_ITEMS : MAX_PUBLIC_LIST_ITEM_CHARS });
  }
  return errors;
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a == null || b == null) return a == b;
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * 編輯頁儲存用（omitUnchangedGallery 的泛化）：五個文字欄位若與載入時「完全相同」就從 payload 拿掉。
 * PUT 是 partial，未送欄位 server 不動；歷史超量資料因此不會擋住其他欄位的儲存。
 * 比較是逐字（字串 ===、陣列逐項 ===、順序有意義），不做 trim；
 * 使用者明確清空（'' 或 []）而原值非空，就是變更，必須送出。
 */
export function omitUnchangedTripTextFields<T extends TripTextFields>(
  form: T,
  original: TripTextFields | null | undefined,
): T {
  const next: T = { ...form };
  for (const field of ['description', 'safetyNotice'] as const) {
    if (field in next && (next[field] ?? undefined) === (original?.[field] ?? undefined)) delete next[field];
  }
  for (const field of ['inclusions', 'exclusions', 'notices'] as const) {
    if (field in next && sameList(next[field], original?.[field])) delete next[field];
  }
  return next;
}

/* ------------------------------------------------------------------------- 複製行程草稿 */

/** 複製草稿：清單欄位以「一行一項」的原始文字保存，打字時不會被吃掉換行。 */
export type TripCopyDraft = {
  description: string;
  safetyNotice: string;
  inclusionsText: string;
  exclusionsText: string;
  noticesText: string;
};

/** 一行一項 → 項目陣列（trim、丟掉空白行）。 */
export function textToTripLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** 以來源行程「完整」內容建立草稿（絕不截斷）。 */
export function tripCopyDraftFromFields(fields: TripTextFields): TripCopyDraft {
  return {
    description: fields.description ?? '',
    safetyNotice: fields.safetyNotice ?? '',
    inclusionsText: (fields.inclusions ?? []).join('\n'),
    exclusionsText: (fields.exclusions ?? []).join('\n'),
    noticesText: (fields.notices ?? []).join('\n'),
  };
}

export function tripCopyDraftToFields(draft: TripCopyDraft): Required<TripTextFields> {
  return {
    description: draft.description,
    safetyNotice: draft.safetyNotice,
    inclusions: textToTripLines(draft.inclusionsText),
    exclusions: textToTripLines(draft.exclusionsText),
    notices: textToTripLines(draft.noticesText),
  };
}

const DRAFT_KEY: Record<TripTextField, keyof TripCopyDraft> = {
  description: 'description', safetyNotice: 'safetyNotice',
  inclusions: 'inclusionsText', exclusions: 'exclusionsText', notices: 'noticesText',
};

/**
 * 草稿 → 要送出的五個欄位。使用者沒動過的欄位（草稿文字與初始草稿相同）原樣沿用來源值，
 * 不經過 join／split／trim 重新整理（與直接複製路徑一致）；只有被編輯的欄位才解析與正規化。
 */
export function resolveTripCopyFields(
  source: TripTextFields, initial: TripCopyDraft, draft: TripCopyDraft,
): Required<TripTextFields> {
  const edited = tripCopyDraftToFields(draft);
  const pick = <K extends TripTextField>(key: K, fallback: Required<TripTextFields>[K]) =>
    (draft[DRAFT_KEY[key]] === initial[DRAFT_KEY[key]] ? (source[key] ?? fallback) : edited[key]) as Required<TripTextFields>[K];
  return {
    description: pick('description', ''),
    safetyNotice: pick('safetyNotice', ''),
    inclusions: pick('inclusions', []),
    exclusions: pick('exclusions', []),
    notices: pick('notices', []),
  };
}

/**
 * 複製流程的決策：來源五個文字欄位全部合規 → 直接複製（payload 原樣）；
 * 否則需要先開草稿修正。來源行程永遠不會被修改，來源內容也不會被截斷。
 */
export function decideTripCopy<T extends TripTextFields>(
  payload: T,
): { kind: 'direct'; payload: T } | { kind: 'draft'; draft: TripCopyDraft; errors: TripTextFieldError[] } {
  const errors = tripTextFieldErrors(payload);
  if (errors.length === 0) return { kind: 'direct', payload };
  return { kind: 'draft', draft: tripCopyDraftFromFields(payload), errors };
}

/**
 * 草稿確認：以「目前草稿」解析五個欄位，仍有錯誤就不能送；通過時編輯後的欄位覆蓋來源 payload。
 */
export function confirmTripCopyDraft<T extends TripTextFields>(
  payload: T, initial: TripCopyDraft, draft: TripCopyDraft,
): { ok: true; payload: T } | { ok: false; errors: TripTextFieldError[] } {
  const fields = resolveTripCopyFields(payload, initial, draft);
  const errors = tripTextFieldErrors(fields);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, payload: { ...payload, ...fields } };
}

/** 相容舊名稱（測試與既有呼叫端）。 */
export function planTripCopy(source: TripTextFields) {
  const d = decideTripCopy(source);
  return d.kind === 'direct' ? ({ kind: 'direct' } as const) : d;
}

/**
 * 複製草稿每個欄位的「顯示值＋錯誤」，與實際送出／驗證用同一份 resolveTripCopyFields。
 * 顯示值：文字欄位是字串；清單欄位是計入上限的項目（inclusions 以伺服器看到的換行傳輸形式拆開）。
 */
export function tripCopyDraftMeta(
  source: TripTextFields, initial: TripCopyDraft, draft: TripCopyDraft,
): { fields: Required<TripTextFields>; errors: TripTextFieldError[]; display: Record<TripTextField, string | string[]> } {
  const fields = resolveTripCopyFields(source, initial, draft);
  return {
    fields,
    errors: tripTextFieldErrors(fields),
    display: {
      description: fields.description,
      safetyNotice: fields.safetyNotice,
      inclusions: fields.inclusions.join('\n').split(/\r?\n/),
      exclusions: fields.exclusions,
      notices: fields.notices,
    },
  };
}
