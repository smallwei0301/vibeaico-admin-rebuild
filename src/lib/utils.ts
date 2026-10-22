import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 貨幣格式：原站一律 NT$ + 千分位，無小數 */
export function formatCurrency(n: number): string {
  return `NT$${Math.round(n).toLocaleString('zh-TW')}`;
}

/** 數字千分位（表格右對齊時搭配 tabular-nums） */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-TW');
}

export function formatPercent(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

/**
 * 取出某個瞬間在指定 IANA 時區的年月日時分（#936）。
 * 只供下方 formatDate／formatTime 等共用；呼叫端傳入的時區需先經 resolvePublicTimeZone 正規化。
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(iso: string, timeZone: string) {
  const date = new Date(iso);
  // 無效日期：與不帶時區路徑一致輸出 NaN 字樣，不丟 RangeError 讓整張表格崩潰。
  if (isNaN(date.getTime())) return { y: 'NaN', mo: 'NaN', d: 'NaN', h: 'NaN', mi: 'NaN' };
  const parts = zonedFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/**
 * 2026/08/20
 * 不傳 timeZone 時沿用瀏覽器本地時區（既有行為）；傳入店家時區則以該時區切日界線（#936）。
 */
export function formatDate(iso: string, timeZone?: string): string {
  if (timeZone) {
    const p = zonedParts(iso, resolvePublicTimeZone(timeZone));
    return `${p.y}/${p.mo}/${p.d}`;
  }
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 2026/08/20 14:30 */
export function formatDateTime(iso: string, timeZone?: string): string {
  if (timeZone) {
    const p = zonedParts(iso, resolvePublicTimeZone(timeZone));
    return `${p.y}/${p.mo}/${p.d} ${p.h}:${p.mi}`;
  }
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 14:30 */
export function formatTime(iso: string, timeZone?: string): string {
  if (timeZone) {
    const p = zonedParts(iso, resolvePublicTimeZone(timeZone));
    return `${p.h}:${p.mi}`;
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 某瞬間在店家時區的當地日期（YYYY-MM-DD），供 <input type="date"> 預填。 */
export function zonedYmd(iso: string, timeZone: string): string {
  const p = zonedParts(iso, resolvePublicTimeZone(timeZone));
  return `${p.y}-${p.mo}-${p.d}`;
}

/**
 * 把店家時區的「當地日期 + 時間」換成 UTC ISO 字串（取代 `new Date(`${date}T${time}:00`)` 的瀏覽器時區解讀）。
 * 以兩次偏移修正處理 DST；遇到不存在的當地時間（DST 跳時）時落在跳時後的瞬間。
 */
export function zonedLocalToIso(date: string, time: string, timeZone: string): string {
  const zone = resolvePublicTimeZone(timeZone);
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const p = zonedParts(new Date(ms).toISOString(), zone);
    return Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d), Number(p.h), Number(p.mi)) - Math.floor(ms / 60000) * 60000;
  };
  const g1 = wall - offsetAt(wall);
  const g2 = wall - offsetAt(g1);
  if (g1 === g2) return new Date(g2).toISOString();
  // 兩次修正不收斂：當地時間落在 DST 跳時缺口（不存在），取缺口結束後的瞬間（兩個候選中較晚者）。
  // 若 g2 當地顯示與請求一致則為重複小時的有效解，沿用 g2（保持既有行為）。
  const back = zonedParts(new Date(g2).toISOString(), zone);
  const backWall = Date.UTC(Number(back.y), Number(back.mo) - 1, Number(back.d), Number(back.h), Number(back.mi));
  if (backWall === wall) return new Date(g2).toISOString();
  return new Date(Math.max(g1, g2)).toISOString();
}

export const WEEKDAYS_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export function weekdayZh(iso: string, timeZone?: string): string {
  if (timeZone) {
    const [y, m, d] = zonedYmd(iso, timeZone).split('-').map(Number);
    return WEEKDAYS_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  return WEEKDAYS_ZH[new Date(iso).getDay()];
}

/** 把 ISO 瞬間換成店家時區當地的 `YYYY-MM-DDTHH:mm`，給 datetime-local 輸入預填用（#936）。 */
export function toZonedDatetimeLocal(iso: string, timeZone: string): string {
  return `${zonedYmd(iso, timeZone)}T${formatTime(iso, timeZone)}`;
}

/** `toZonedDatetimeLocal` 的反向：datetime-local 值以店家時區解讀並轉回 UTC ISO（#936）。 */
export function zonedDatetimeLocalToIso(value: string, timeZone: string): string {
  const [date, time] = value.split('T');
  return zonedLocalToIso(date, time ?? '00:00', timeZone);
}
