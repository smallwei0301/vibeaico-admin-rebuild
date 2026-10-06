/**
 * 公開行程詳情的店家時區工具（canonical 18 L104：使用 tenant timezone）。
 * 時區缺值、非字串、過長（>64）或 Intl 無法識別時回退 Asia/Taipei。
 */
export const PUBLIC_DEFAULT_TIME_ZONE = 'Asia/Taipei';

export function resolvePublicTimeZone(value: unknown): string {
  if (typeof value !== 'string') return PUBLIC_DEFAULT_TIME_ZONE;
  const zone = value.trim();
  if (!zone || zone.length > 64) return PUBLIC_DEFAULT_TIME_ZONE;
  try {
    // 回傳正規化後的 canonical 名稱；偏移寫法（如 +08:00）無法正規化成 IANA 名稱，回退台北。
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
    if (!canonical || /^[+-]\d/.test(canonical)) return PUBLIC_DEFAULT_TIME_ZONE;
    return canonical;
  } catch {
    return PUBLIC_DEFAULT_TIME_ZONE;
  }
}

/** 店家時區的「現在」：同一個時間點切出日期（YYYY-MM-DD）與 HH:mm。 */
export function tenantNowParts(timeZone: string, nowMs: number = Date.now()): { today: string; hm: string } {
  const zone = resolvePublicTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { today: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
}

/**
 * 今天（店家時區）且開始時間已到或已過的團次不可列出。
 * `start_time` 為 null 的今天團次維持列出：沒有開始時間，無法判定是否已開始。
 * 明天以後的團次不受影響。（reserve_seats／create_tour_order 的權威檢查是既有行為，不在此處理。）
 */
export function hasStartedToday(
  row: { departs_on?: unknown; start_time?: unknown },
  now: { today: string; hm: string },
): boolean {
  if (row.departs_on !== now.today) return false;
  if (row.start_time == null) return false;
  return String(row.start_time).slice(0, 5) <= now.hm;
}
