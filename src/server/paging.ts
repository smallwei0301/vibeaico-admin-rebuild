import { z } from 'zod';

/**
 * 單次請求最多能取幾筆。
 *
 * ⚠️ 這個常數存在的理由，是 2026-08-25 頁面層實測抓到的一個**整頁死掉**的 bug：
 * `/tenant/bookings` 與 `/tenant/points` 的 `load()` 送 `size: 200`，但那兩支端點
 * 各自寫死 `.max(100)`，於是清單頁在部署環境**完全載不出東西**，畫面只顯示
 * 「目前沒有預約 / 共 0 筆」加一則紅字「Number must be less than or equal to 100」。
 * 資料庫裡明明有資料。
 *
 * 為什麼三層測試都沒抓到：
 * - 單元測試不涵蓋頁面
 * - 整合測試直接打端點，而且用的是**合法的** size，所以永遠是綠的
 * - e2e 只跑測試矩陣點名的頁面
 *
 * 上限本身沒有錯，錯在**頁面送的值與端點收的值分別寫死在兩個地方、沒有人保證一致**。
 * 所以修法不是把那兩個數字改成一樣，而是讓它們**沒有機會不一樣**：
 * 端點一律用下面的 `pageSizeSchema()`，頁面一律用 `MAX_PAGE_SIZE`，
 * 並由 `tests/unit/page-size-contract.test.ts` 靜態鎖住兩件事。
 */
export const MAX_PAGE_SIZE = 200;

/**
 * 端點的 `size` query 參數 schema。`defaultSize` 是沒帶 size 時的預設筆數
 * （各端點不同，例如聊天訊息是 50、其餘多為 20），**上限一律 `MAX_PAGE_SIZE`**。
 *
 * 不要在端點裡自己寫 `z.coerce.number().int().min(1).max(…)` —— 那正是漂掉的來源。
 */
export const pageSizeSchema = (defaultSize = 20) =>
  z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(defaultSize);

export function pageRange(page = 0, size = 20) {
  const from = page * size;
  return { from, to: from + size - 1, page, size };
}

export function toPaged<T>(rows: T[], count: number | null, page: number, size: number) {
  const total = count ?? 0;
  return { content: rows, totalElements: total,
           totalPages: Math.ceil(total / size), number: page, size };
}
