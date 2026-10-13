/**
 * #886：訂單詳情的取消／退款政策文字。政策條文與旅客下單時看到的同一份
 * （由呼叫端傳入 i18n map，避免在此重複文案）；快照為空或不在 map 內回傳 null。
 */
export function refundPolicyText(
  snapshot: string | null | undefined,
  map: Record<string, string>,
): string | null {
  if (!snapshot) return null;
  return Object.prototype.hasOwnProperty.call(map, snapshot) ? map[snapshot] : null;
}
