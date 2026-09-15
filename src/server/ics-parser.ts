/**
 * src/server/ics-parser.ts — 極窄範圍 iCalendar (RFC 5545) VEVENT 解析（Issue #21）。
 * -----------------------------------------------------------------------------
 * 選擇「手寫窄範圍解析」而非引入套件的理由：
 *   - repo 目前完全沒有任何 ICS/iCalendar 相依（`package.json` 沒有 `ical`／
 *     `node-ical`／`ics`／`rrule`），Issue 驗收標準只要求四件事：基本 VEVENT
 *     （UID/SUMMARY/DTSTART/DTEND）、all-day 事件、timezone、
 *     `STATUS:CANCELLED` 排除——沒有一項需要完整 RFC 5545（`rrule` 循環規則、
 *     VALARM、VTIMEZONE 內嵌定義……都不在範圍內）。
 *   - `node-ical` 之類套件會把 RRULE 展開邏輯、VTIMEZONE override 解析等一大坨
 *     「這個 Issue 沒要求」的複雜度一併帶進來，對外部輸入的解析路徑而言，
 *     多帶一個沒被完整讀過的相依比手寫一段窄範圍、每一行都看得懂在做什麼的
 *     parser 風險更高。
 *   - 因此這裡**只**處理：BEGIN/END:VEVENT 區塊、UID、SUMMARY、STATUS、
 *     DTSTART/DTEND 的三種寫法（`...Z` UTC、`;TZID=…` 具名時區、
 *     `;VALUE=DATE:YYYYMMDD` all-day）、RFC 5545 的 line folding（延續行以
 *     空白或 tab 開頭）與最基本的 `\,` `\;` `\n` escape。**不**支援 RRULE
 *     循環展開——來源行事曆若用循環規則產生事件，這裡只會看到 ICS 檔案裡
 *     實際列出的那些 VEVENT（多數行事曆服務匯出時本來就會展開成獨立事件）。
 */

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  /** ISO 8601 UTC */
  startAt: string;
  /** ISO 8601 UTC */
  endAt: string;
  allDay: boolean;
};

/** RFC 5545 §3.1 line folding：延續行以單一空白或 tab 開頭，接回上一行尾端。 */
function unfold(icsText: string): string[] {
  const rawLines = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw.trim() !== '') {
      lines.push(raw);
    }
  }
  return lines;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } {
  const colonIdx = line.indexOf(':');
  const left = colonIdx === -1 ? line : line.slice(0, colonIdx);
  const value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
  const [name, ...paramParts] = left.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/** 某 IANA 時區在指定「已當成 UTC 解讀」的猜測時刻，實際的 UTC 偏移（分鐘）。 */
function tzOffsetMinutesAt(utcGuessMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcGuessMs)).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const reinterpretedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (reinterpretedAsUtc - utcGuessMs) / 60_000;
}

/** 把「某個 IANA 時區裡的壁鐘時間」轉成正確的 UTC 毫秒數（含 DST 邊界的二次校正）。 */
function zonedWallTimeToUtcMs(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset1 = tzOffsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = tzOffsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) utc = guess - offset2 * 60_000;
  return utc;
}

/**
 * 解析 DTSTART/DTEND 的值，回傳 { iso, allDay }。
 * 三種形式：
 *   - `;VALUE=DATE:YYYYMMDD` → all-day，當地曆日期，這裡以 UTC midnight 表示。
 *   - `...Z` 結尾（`YYYYMMDDTHHMMSSZ`）→ UTC。
 *   - `;TZID=Area/City:YYYYMMDDTHHMMSS` → 具名時區壁鐘時間，換算成 UTC。
 *   - 都沒有（floating time，無 Z 無 TZID）→ 簡化處理，當成 UTC（Issue 範圍
 *     沒有要求 floating time 的完整語意，這裡誠實選擇最簡單、可預期的解讀）。
 */
function parseDateValue(value: string, params: Record<string, string>): { iso: string; allDay: boolean } {
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(value);
  if (isDateOnly) {
    const y = Number(value.slice(0, 4));
    const mo = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return { iso: new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString(), allDay: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) throw new Error(`無法解析的日期時間值：${value}`);
  const [, yy, mo, dd, hh, mi, ss, zulu] = m;
  const y = Number(yy), moN = Number(mo), d = Number(dd), h = Number(hh), min = Number(mi), s = Number(ss);

  if (zulu) {
    return { iso: new Date(Date.UTC(y, moN - 1, d, h, min, s)).toISOString(), allDay: false };
  }
  if (params.TZID) {
    const utcMs = zonedWallTimeToUtcMs(y, moN, d, h, min, s, params.TZID);
    return { iso: new Date(utcMs).toISOString(), allDay: false };
  }
  // Floating time：無時區資訊，簡化當成 UTC。
  return { iso: new Date(Date.UTC(y, moN - 1, d, h, min, s)).toISOString(), allDay: false };
}

let fallbackUidCounter = 0;

/** 解析整份 ICS 內容，回傳所有**非取消**的 VEVENT。 */
export function parseIcs(icsText: string): ParsedIcsEvent[] {
  const lines = unfold(icsText);
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let uid = '';
  let title = '';
  let status = '';
  let dtStart: { iso: string; allDay: boolean } | null = null;
  let dtEnd: { iso: string; allDay: boolean } | null = null;

  for (const rawLine of lines) {
    const { name, params, value } = parseLine(rawLine);

    if (name === 'BEGIN' && value === 'VEVENT') {
      inEvent = true;
      uid = '';
      title = '';
      status = '';
      dtStart = null;
      dtEnd = null;
      continue;
    }
    if (!inEvent) continue;

    if (name === 'END' && value === 'VEVENT') {
      inEvent = false;
      if (status.toUpperCase() === 'CANCELLED') continue; // 驗收標準：CANCELLED 不得殘留
      if (!dtStart) continue; // 沒有起始時間的事件無法在行事曆上顯示，安全跳過
      const start = dtStart;
      // DTEND 缺席：all-day 依 RFC 5545 預設 1 天；有時間的事件保守用同一時刻
      // （沒有更好的預設值可猜，不假造一個看起來合理但沒根據的長度）。
      const end = dtEnd ?? (start.allDay
        ? { iso: new Date(Date.parse(start.iso) + 24 * 60 * 60 * 1000).toISOString(), allDay: true }
        : { iso: start.iso, allDay: false });
      events.push({
        uid: uid || `sha:${title}:${start.iso}:${(fallbackUidCounter += 1)}`,
        title: title || '(無標題事件)',
        startAt: start.iso,
        endAt: end.iso,
        allDay: start.allDay,
      });
      continue;
    }

    switch (name) {
      case 'UID':
        uid = unescapeText(value);
        break;
      case 'SUMMARY':
        title = unescapeText(value);
        break;
      case 'STATUS':
        status = value.trim();
        break;
      case 'DTSTART':
        try { dtStart = parseDateValue(value, params); } catch { dtStart = null; }
        break;
      case 'DTEND':
        try { dtEnd = parseDateValue(value, params); } catch { dtEnd = null; }
        break;
      default:
        break;
    }
  }

  return events;
}
