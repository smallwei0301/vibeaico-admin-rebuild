/** 預約頁的純函式 helper（#903）：批次結果彙整與編輯預約的人員選項。 */

export interface BatchOutcome {
  succeeded: string[];
  failed: string[];
}

/** 把 Promise.allSettled 的結果依原 id 順序分成成功與失敗兩組。 */
export function summarizeBatch(ids: string[], results: PromiseSettledResult<unknown>[]): BatchOutcome {
  const succeeded: string[] = [];
  const failed: string[] = [];
  ids.forEach((id, i) => {
    if (results[i]?.status === 'fulfilled') succeeded.push(id);
    else failed.push(id);
  });
  return { succeeded, failed };
}

export interface StaffOptionSource {
  id: string;
  name: string;
  bookable?: boolean;
}

export interface StaffOption {
  value: string;
  kind: 'bookable' | 'currentInactive' | 'currentUnknown';
  name: string;
}

/**
 * 編輯預約的人員下拉選項：所有可預約人員，加上「目前指定」的人員——
 * 即使其已停止接受預約或不在清單內，也要有對應選項，畫面才與送出值一致。
 */
export function buildStaffOptions(staff: StaffOptionSource[], currentStaffId: string): StaffOption[] {
  const options: StaffOption[] = staff
    .filter((s) => s.bookable)
    .map((s) => ({ value: s.id, kind: 'bookable', name: s.name }));
  if (currentStaffId && !options.some((o) => o.value === currentStaffId)) {
    const found = staff.find((s) => s.id === currentStaffId);
    options.push(
      found
        ? { value: found.id, kind: 'currentInactive', name: found.name }
        : { value: currentStaffId, kind: 'currentUnknown', name: '' },
    );
  }
  return options;
}
