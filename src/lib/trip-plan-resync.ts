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
