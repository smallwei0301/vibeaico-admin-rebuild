/**
 * #921：把使用者輸入的關鍵字安全帶入 PostgREST `.or()` 過濾字串。
 *
 * 直接把關鍵字拼進 `col.ilike.%${keyword}%` 時，關鍵字內的 `,` `(` `)` 會被 PostgREST
 * 當成條件分隔／群組符號而切壞過濾字串。PostgREST 的解法是把值用雙引號包起來，
 * 雙引號內只有 `"` 與 `\` 需要以反斜線跳脫。
 *
 * 兩層跳脫，順序不可顛倒：
 * 1. LIKE 層：`\` `%` `_` 前面加 `\`（PostgreSQL LIKE／ILIKE 預設 escape 字元就是 `\`），
 *    店家輸入「50%」才會是字面比對，而不是「50 開頭任意字串」。
 * 2. PostgREST 引號層：上一步產生的字串再把 `\` `"` 前面加 `\`。
 *
 * 已知限制：PostgREST 的 like／ilike 會把值內的 `*` 視為 `%`（URL 友善別名），
 * 該替換發生在 LIKE 跳脫之前，無法跳脫；輸入 `*` 會變成「任意字元」，
 * 結果只會比字面比對多，不會報錯，因此刻意不處理。
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function quotePostgrestValue(raw: string): string {
  return `"${raw.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * 回傳可直接傳給 `.or()` 的字串：每個欄位做「包含關鍵字、不分大小寫」比對，彼此為 OR。
 * 欄位名稱（含 jsonb 路徑如 `contact->>name`）由呼叫端提供，必須是程式內的常數，不可來自使用者輸入。
 */
export function ilikeAnyOf(columns: string[], keyword: string): string {
  const value = quotePostgrestValue(`%${escapeLikePattern(keyword)}%`);
  return columns.map((col) => `${col}.ilike.${value}`).join(',');
}
