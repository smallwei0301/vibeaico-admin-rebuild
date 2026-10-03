import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';

type FormationInput = {
  minToDepart?: number | null;
  formationDeadlineAt?: string | null;
  formationStatus?: string | null;
  /** 客滿：狀態文案不得暗示還能加入。 */
  soldOut?: boolean;
};

/** 成團截止時間以店家時區顯示（M/D HH:mm；時區缺值或無效回退台北）；無法解析回 null，不顯示假值。 */
export function formatFormationDeadline(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolvePublicTimeZone(timeZone), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${Number(get('month'))}/${Number(get('day'))} ${get('hour')}:${get('minute')}`;
}

/**
 * 19 分冊 §2.1：只有 FIXED_DEPARTURE 才顯示成團資訊；欄位為 null／未知時略過該項。
 * 回傳要顯示的文字清單（可能為空）。
 */
export function formationLines(salesMode: string, departure: FormationInput, timeZone?: string): string[] {
  if (salesMode !== 'FIXED_DEPARTURE') return [];
  const lines: string[] = [];
  const min = departure.minToDepart;
  if (typeof min === 'number') {
    lines.push(t.departures.formation.minToDepart(min));
  }
  const deadline = formatFormationDeadline(departure.formationDeadlineAt, timeZone);
  if (deadline) lines.push(t.departures.formation.deadline(deadline));
  // 客滿時優先用不暗示「尚可加入／招募中」的文案；沒有專屬文案的狀態沿用一般文案。
  const maps = departure.soldOut === true
    ? [t.departures.formation.statusSoldOut, t.departures.formation.status]
    : [t.departures.formation.status];
  let status: string | undefined;
  for (const map of maps) {
    if (departure.formationStatus && Object.prototype.hasOwnProperty.call(map, departure.formationStatus)) {
      status = map[departure.formationStatus];
      break;
    }
  }
  if (status) lines.push(status);
  return lines;
}
