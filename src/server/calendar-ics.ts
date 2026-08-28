import type { CalendarEvent } from '@/lib/types';

const ICS_LINE_ENDING = '\r\n';

/**
 * Formats the occupied events already selected by the authenticated calendar
 * query.  It intentionally has no route/token responsibility: the canonical
 * contracts have not selected an ICS delivery URL or access model yet.
 */
export function formatOccupiedCalendarEventsAsIcs(
  events: CalendarEvent[],
  generatedAt = new Date(),
): string {
  const vevents = events
    .filter(isIcsOccupiedEvent)
    .flatMap((event) => formatEvent(event, generatedAt));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VibeAI//Tenant calendar//ZH-TW',
    'CALSCALE:GREGORIAN',
    ...vevents,
    'END:VCALENDAR',
    '',
  ].join(ICS_LINE_ENDING);
}

function isIcsOccupiedEvent(event: CalendarEvent): boolean {
  // EXTERNAL is an imported, read-only source. Re-exporting it would duplicate
  // the source calendar and does not represent this tenant's occupied time.
  return event.type === 'BOOKING' || event.type === 'BLOCK' || event.type === 'DEPARTURE';
}

function formatEvent(event: CalendarEvent, generatedAt: Date): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}@vibeaico`,
    `DTSTAMP:${formatIcsTimestamp(generatedAt)}`,
    `DTSTART:${formatIcsTimestamp(new Date(event.start))}`,
    `DTEND:${formatIcsTimestamp(new Date(event.end))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  const description = descriptionFor(event);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (event.type === 'DEPARTURE' && event.meta?.departureStatus === 'CANCELLED') {
    lines.push('STATUS:CANCELLED');
  }
  lines.push('END:VEVENT');
  return lines;
}

function descriptionFor(event: CalendarEvent): string | null {
  if (event.type !== 'DEPARTURE') return null;

  const lines: string[] = [];
  if (event.meta?.primaryStaffName) lines.push(`主導遊：${event.meta.primaryStaffName}`);
  const assistants = event.meta?.assistantStaffNames?.filter(Boolean) ?? [];
  if (assistants.length > 0) lines.push(`協同導遊：${assistants.join('、')}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function formatIcsTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace('.000', '');
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
