import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';

type FormationInput = {
  minToDepart?: number | null;
  formationDeadlineAt?: string | null;
  formationStatus?: string | null;
};

const TAIPEI = 'Asia/Taipei';

/** 成團截止時間以台北時間顯示（M/D HH:mm）；無法解析回 null，不顯示假值。 */
export function formatFormationDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TAIPEI, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${Number(get('month'))}/${Number(get('day'))} ${get('hour')}:${get('minute')}`;
}

/**
 * 19 分冊 §2.1：只有 FIXED_DEPARTURE 才顯示成團資訊；欄位為 null／未知時略過該項。
 * 回傳要顯示的文字清單（可能為空）。
 */
export function formationLines(salesMode: string, departure: FormationInput): string[] {
  if (salesMode !== 'FIXED_DEPARTURE') return [];
  const lines: string[] = [];
  const min = departure.minToDepart;
  if (typeof min === 'number') {
    lines.push(t.departures.formation.minToDepart(min));
  }
  const deadline = formatFormationDeadline(departure.formationDeadlineAt);
  if (deadline) lines.push(t.departures.formation.deadline(deadline));
  const status = departure.formationStatus
    ? Object.prototype.hasOwnProperty.call(t.departures.formation.status, departure.formationStatus)
      ? t.departures.formation.status[departure.formationStatus] : undefined
    : undefined;
  if (status) lines.push(status);
  return lines;
}
