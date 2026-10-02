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
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
    return zone;
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
