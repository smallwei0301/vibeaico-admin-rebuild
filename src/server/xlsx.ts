// 共用 xlsx 產生器（issue #246）。
//
// 為什麼要有這一支：在此之前三個「匯出 Excel」出口實際都回 CSV——按鈕真的下載了
// 檔案，所以「按了有沒有反應」那一層判準抓不到它。14-GAP-AUDIT §8.3 早就裁示用
// `exceljs`，只是從未落地。
//
// 這裡只做「把表頭與列資料變成一份真的活頁簿」，不含任何查詢或授權邏輯——
// 那些留在各自的 route，避免這支變成第二個放商業規則的地方。
import ExcelJS from 'exceljs';

/** 一格的值：字串、數字，或空。與 CSV 版本接受的型別一致。 */
export type XlsxCell = string | number | null | undefined;

/**
 * 產生 xlsx buffer。
 *
 * 注意欄寬：`exceljs` 不會自己量文字寬度，全部留預設會讓中文欄擠成一團。
 * 這裡用「表頭與各列字串長度的最大值」粗估，中日韓字元算兩個寬度單位。
 */
export async function buildXlsx(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly XlsxCell[])[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow([...headers]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row.map((cell) => (cell == null ? '' : cell)));

  sheet.columns = headers.map((header, index) => ({
    width: Math.min(
      60,
      Math.max(
        displayWidth(header),
        ...rows.map((row) => displayWidth(row[index])),
        8,
      ) + 2,
    ),
  }));

  // exceljs 回 ArrayBuffer-like；轉成 Buffer 讓 Response 與測試都好處理。
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function displayWidth(value: XlsxCell): number {
  const text = value == null ? '' : String(value);
  let width = 0;
  for (const char of text) width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char) ? 2 : 1;
  return width;
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 與 CSV 出口相同的回應慣例：attachment、不走 { success, data } 信封、不快取。 */
export function xlsxResponse(fileName: string, body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
