/**
 * 方案排序（多筆 PATCH）失敗時，伺服器端可能已有部分更新成功，畫面上的順序就不可信（#930）。
 * 重新讀取清單並套用；重讀本身失敗則靜默保留原狀，不再多跳一個錯誤。
 */
export async function resyncAfterFailure<T>(
  fetchList: () => Promise<T[]>,
  apply: (list: T[]) => void,
): Promise<boolean> {
  try {
    apply(await fetchList());
    return true;
  } catch {
    return false;
  }
}

export type SaveAllResult = { ok: true } | { ok: false; error: unknown };

/**
 * 多筆排序寫入：等「全部」請求 settled 後才判斷結果（#930）。
 * 不用 Promise.all——它在第一筆失敗就 reject，其餘 PATCH 仍在背景執行，
 * 立刻重讀可能讀到中間狀態，之後較慢的請求成功又會改變伺服器順序。
 * - 全部成功：重讀清單並套用；重讀失敗視為失敗（回傳其錯誤）。
 * - 任一失敗：全部 settled 後回傳第一個失敗原因，並重讀清單對齊（重讀失敗靜默保留原狀）。
 */
export async function saveAllThenResync<T>(
  saves: Array<() => Promise<unknown>>,
  fetchList: () => Promise<T[]>,
  apply: (list: T[]) => void,
): Promise<SaveAllResult> {
  const settled = await Promise.allSettled(saves.map((save) => save()));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) {
    await resyncAfterFailure(fetchList, apply);
    return { ok: false, error: failed.reason };
  }
  try {
    apply(await fetchList());
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
