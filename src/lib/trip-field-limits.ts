import {
  MAX_PUBLIC_LIST_ITEM_CHARS, MAX_PUBLIC_LIST_ITEMS,
  MAX_PUBLIC_LONG_TEXT_CHARS, MAX_PUBLIC_SHORT_TEXT_CHARS,
  MAX_TRIP_INCLUDES_RAW_CHARS, MAX_TRIP_LIST_ITEM_RAW_CHARS, MAX_TRIP_LIST_RAW_ITEMS,
} from '@/lib/public-trip-limits';

/** Match public text clipping's Unicode code-point count, without changing the submitted text. */
export function withinTripTextLimit(value: string, maxCodePoints: number): boolean {
  let count = 0;
  for (const _char of value) {
    if (++count > maxCodePoints) return false;
  }
  return true;
}

export type TripListViolation = 'tooManyItems' | 'itemTooLong' | 'tooManyRawItems' | 'itemRawTooLong';
/** includes 另有整體原始字數上限。 */
export type TripIncludesViolation = TripListViolation | 'includesRawTooLarge';

/** 違規種類 → 對應上限數字（UI 文案用）。 */
export function tripViolationLimit(kind: TripIncludesViolation): number {
  switch (kind) {
    case 'tooManyItems': return MAX_PUBLIC_LIST_ITEMS;
    case 'itemTooLong': return MAX_PUBLIC_LIST_ITEM_CHARS;
    case 'tooManyRawItems': return MAX_TRIP_LIST_RAW_ITEMS;
    case 'itemRawTooLong': return MAX_TRIP_LIST_ITEM_RAW_CHARS;
    case 'includesRawTooLarge': return MAX_TRIP_INCLUDES_RAW_CHARS;
  }
}

/**
 * 清單規則（兩層）：
 * 1. 可見上限：忽略空白項、每項 trim 後 ≤ 300 code points，最多 20 項。
 * 2. 原始天花板（#785）：原始項數 ≤ 200（含空白項）、每項原始未 trim ≤ 3000 code points。
 * 回報優先序：**可見違規一旦存在就優先回報**（tooManyItems > itemTooLong），raw 種類只在可見規則全過時才回報，
 * 這樣 UI 的提示指向使用者真正該改的地方。pass/fail 與回報順序無關：任一違規即失敗。
 * 效能：原始項數 > 200 走有界快速路徑：只數可見項（找到第 21 個即回 tooManyItems），不足才回 tooManyRawItems；
 * 逐項只做 early-exit 的 code point 計數與一次 trim（線性），不建立額外大陣列。
 */
const NON_BLANK = /\S/;

/**
 * >200 項／行的有界掃描：每項先用 /\S/ 判斷是否可見（與 trim 的空白定義一致，遇第一個非空白字元即停），
 * 可見項才 trim 並以 withinTripTextLimit（超過 300 即停）記錄 itemTooLong；add() 在第 21 個可見項時回 true。
 */
class VisibleScan {
  visible = 0;
  itemTooLong = false;
  add(raw: string): boolean {
    if (!NON_BLANK.test(raw)) return false;
    if (!this.itemTooLong && !withinTripTextLimit(raw.trim(), MAX_PUBLIC_LIST_ITEM_CHARS)) this.itemTooLong = true;
    return ++this.visible > MAX_PUBLIC_LIST_ITEMS;
  }
}

export function tripListViolation(items: readonly string[]): TripListViolation | null {
  if (items.length > MAX_TRIP_LIST_RAW_ITEMS) {
    // 快速路徑（不配置陣列）：只數可見項並記錄 itemTooLong，找到第 21 個可見項就回 tooManyItems。
    const scan = new VisibleScan();
    for (const item of items) if (scan.add(item)) return 'tooManyItems';
    return scan.itemTooLong ? 'itemTooLong' : 'tooManyRawItems';
  }
  let count = 0;
  let itemTooLong = false;
  let itemRawTooLong = false;
  for (const item of items) {
    if (!withinTripTextLimit(item, MAX_TRIP_LIST_ITEM_RAW_CHARS)) itemRawTooLong = true;
    const text = item.trim();
    if (!text) continue;
    count += 1;
    if (!itemTooLong && !withinTripTextLimit(text, MAX_PUBLIC_LIST_ITEM_CHARS)) itemTooLong = true;
  }
  if (count > MAX_PUBLIC_LIST_ITEMS) return 'tooManyItems';
  if (itemTooLong) return 'itemTooLong';
  return itemRawTooLong ? 'itemRawTooLong' : null;
}

export function withinTripListLimits(items: readonly string[]): boolean {
  return tripListViolation(items) === null;
}

/**
 * 行數是否超過 maxLines（行數 = '\n' 個數 + 1；'\r\n' 也含 '\n'）：找到第 maxLines 個換行
 * （即至少 maxLines + 1 行）就回 true。最多掃 maxLines 個換行就停，不 split。
 */
export function hasMoreLinesThan(value: string, maxLines: number): boolean {
  let from = 0;
  for (let i = 0; i < maxLines; i += 1) {
    const at = value.indexOf('\n', from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
}

/** > 200 行時以游標逐行掃描（不 split）：回 'tooManyItems'（第 21 個可見行）、'itemTooLong' 或 null。 */
function scanVisibleLines(value: string): 'tooManyItems' | 'itemTooLong' | null {
  const scan = new VisibleScan();
  let from = 0;
  for (;;) {
    const at = value.indexOf('\n', from);
    if (scan.add(value.slice(from, at < 0 ? value.length : at))) return 'tooManyItems';
    if (at < 0) break;
    from = at + 1;
  }
  return scan.itemTooLong ? 'itemTooLong' : null;
}

/**
 * `includes` 是 UI `inclusions` 清單的換行傳輸形式。
 * 先用有界掃描判斷行數：> 200 行就不 split（避免對巨大字串建大陣列），改以游標逐行數可見行：
 * 第 21 個可見行 → tooManyItems、有可見行 > 300 字 → itemTooLong（可見優先）；否則整體 > 20000 回 includesRawTooLarge，否則 tooManyRawItems。
 * ≤ 200 行才 split（最多 200 個元素），可見違規優先；可見規則全過時，
 * 整體 > 20000 回 includesRawTooLarge，其餘回該清單的 raw 種類。
 */
export function tripIncludesViolation(value: string): TripIncludesViolation | null {
  const wholeTooLarge = !withinTripTextLimit(value, MAX_TRIP_INCLUDES_RAW_CHARS);
  if (hasMoreLinesThan(value, MAX_TRIP_LIST_RAW_ITEMS)) {
    const visibleKind = scanVisibleLines(value);
    if (visibleKind) return visibleKind;
    return wholeTooLarge ? 'includesRawTooLarge' : 'tooManyRawItems';
  }
  const kind = tripListViolation(value.split(/\r?\n/));
  if (kind === 'tooManyItems' || kind === 'itemTooLong') return kind;
  if (wholeTooLarge) return 'includesRawTooLarge';
  return kind;
}

export function withinTripIncludesLimits(value: string): boolean {
  return tripIncludesViolation(value) === null;
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
  | { field: 'inclusions' | 'exclusions' | 'notices'; kind: TripIncludesViolation; limit: number };

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
 * 三個清單最多 20 個非空白項、每項 trim 後最多 300 code points；
 * 另有原始天花板（#785）：原始項數 200、每項原始 3000、includes 整體 20000 code points。
 * inclusions 以 `join('\n')` 經 tripIncludesViolation 判斷，等同伺服器收到的 `includes`。
 */
export function tripTextFieldErrors(fields: TripTextFields): TripTextFieldError[] {
  const errors: TripTextFieldError[] = [];
  if (typeof fields.description === 'string' && !withinTripTextLimit(fields.description, MAX_PUBLIC_LONG_TEXT_CHARS)) {
    errors.push({ field: 'description', kind: 'tooLong', limit: MAX_PUBLIC_LONG_TEXT_CHARS });
  }
  if (typeof fields.safetyNotice === 'string' && !withinTripTextLimit(fields.safetyNotice, MAX_PUBLIC_SHORT_TEXT_CHARS)) {
    errors.push({ field: 'safetyNotice', kind: 'tooLong', limit: MAX_PUBLIC_SHORT_TEXT_CHARS });
  }
  if (Array.isArray(fields.inclusions)) {
    const kind = tripIncludesViolation(fields.inclusions.join('\n'));
    if (kind) errors.push({ field: 'inclusions', kind, limit: tripViolationLimit(kind) });
  }
  for (const field of ['exclusions', 'notices'] as const) {
    const items = fields[field];
    if (!Array.isArray(items)) continue;
    const kind = tripListViolation(items);
    if (kind) errors.push({ field, kind, limit: tripViolationLimit(kind) });
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
