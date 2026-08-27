import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { readUploadForm, uploadToBucket } from '@/server/upload';
import { RICH_MENU_MAX_AREAS } from '@/config/rich-menu-layouts';
import { richMenuDesignSchema, readDesign, writeDesign } from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/upload-cell-icon —— 單格圖示上傳
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.8
 * 原站路徑出處：`docs/specs/rich-menu-design.json:1434`
 *
 * multipart/form-data：`file`（圖片）＋ `cellIndex`（第幾格，0 起算）。
 *
 * ⚠️ 驗證與落地走 `uploadToBucket()`（同 `/api/upload`），不是第二份實作。
 * 它多做的事：把網址寫進 `DRAFT.config.cells[i].icon`，下次開頁面讀得回來。
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ **誠實邊界：圖示不會出現在 LINE 選單的底圖上。**                   ║
 * ║ 本專案沒有影像合成能力（`src/server/png.ts` 只產純色矩形，沒有裝     ║
 * ║ sharp/canvas），`create-*` 上傳給 LINE 的是**底圖原圖**。            ║
 * ║ 所以圖示會被上傳、會被存進草稿、會被讀回來——**顧客看不到它**。       ║
 * ║                                                                      ║
 * ║ 這句話必須寫在**按鈕旁邊**，不能只寫在這裡：店家上傳一個圖示、        ║
 * ║ 看到「已上傳」，合理預期它會出現在選單上。只寫在註解裡，              ║
 * ║ 保護到的是下一個開發者，被誤導的還是店家（CLAUDE.md）。              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const form = await readUploadForm(req);
  const file = form.get('file');
  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);

  const rawIndex = form.get('cellIndex');
  const cellIndex = Number(typeof rawIndex === 'string' ? rawIndex : NaN);
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= RICH_MENU_MAX_AREAS)
    throw new ApiHttpError(400, '格子編號不正確', ERR.VALIDATION);

  const uploaded = await uploadToBucket({
    tenantId: t.tenantId, file, bucket: 'richmenu-assets',
  });

  // 寫進草稿的那一格。沒有草稿就從空設計開始——不寫的話「已上傳」又是半個事實。
  const draft = await readDesign(t.supabase, t.tenantId, 'DRAFT');
  const design = richMenuDesignSchema.parse(draft?.config ?? {});
  const cells = [...design.cells];
  while (cells.length <= cellIndex) {
    cells.push({ label: '', action: 'SEND_TEXT', value: '', icon: '' });
  }
  cells[cellIndex] = { ...cells[cellIndex], icon: uploaded.url };
  await writeDesign(t.supabase, t.tenantId, 'DRAFT', { ...design, cells }, '');

  return ok({
    ...uploaded,
    cellIndex,
    savedTo: 'draft.cells[].icon',
    /**
     * ⚠️ 誠實旗標：圖示存下來了，但**不會合成進 LINE 選單底圖**。
     * 頁面必須照這個旗標顯示說明（見檔頭方框）。
     */
    composedIntoMenuImage: false,
  });
});
