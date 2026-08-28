import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/types';
import { formatOccupiedCalendarEventsAsIcs } from '@/server/calendar-ics';

const departure: CalendarEvent = {
  id: 'departure:dep-1',
  type: 'DEPARTURE',
  title: '北海岸・一日遊',
  start: '2026-09-01T09:00:00+08:00',
  end: '2026-09-01T11:00:00+08:00',
  meta: {
    departureId: 'dep-1',
    departureStatus: 'OPEN',
    primaryStaffName: '王導遊',
    assistantStaffNames: ['小美', '阿杰'],
  },
};

describe('issue #37 calendar ICS formatter', () => {
  it('exports a departure with PRIMARY and ASSISTANT staff in DESCRIPTION', () => {
    const ics = formatOccupiedCalendarEventsAsIcs([departure], new Date('2026-08-28T00:00:00Z'));

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:北海岸・一日遊');
    expect(ics).toContain('DESCRIPTION:主導遊：王導遊\\n協同導遊：小美、阿杰');
    expect(ics).toContain('DTSTART:20260901T010000Z');
    expect(ics).toContain('DTEND:20260901T030000Z');
  });

  it('keeps cancelled departures as cancelled events and uses the current staff assignment', () => {
    const reassigned: CalendarEvent = {
      ...departure,
      meta: {
        ...departure.meta,
        departureStatus: 'CANCELLED',
        primaryStaffName: '新主導遊',
        assistantStaffNames: ['新協同'],
      },
    };

    const ics = formatOccupiedCalendarEventsAsIcs([reassigned], new Date('2026-08-28T00:00:00Z'));

    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('DESCRIPTION:主導遊：新主導遊\\n協同導遊：新協同');
    expect(ics).not.toContain('王導遊');
  });

  it('exports occupied booking/block/departure events only, never an external or availability-like event', () => {
    const booking: CalendarEvent = {
      id: 'booking:b-1', type: 'BOOKING', title: '剪髮・林客人',
      start: '2026-09-02T09:00:00+08:00', end: '2026-09-02T10:00:00+08:00',
    };
    const block: CalendarEvent = {
      id: 'block:exception-1', type: 'BLOCK', title: '不可接案：研習',
      start: '2026-09-02T10:00:00+08:00', end: '2026-09-02T11:00:00+08:00',
    };
    const external: CalendarEvent = {
      id: 'external:source-1', type: 'EXTERNAL', title: '外部來源',
      start: '2026-09-02T11:00:00+08:00', end: '2026-09-02T12:00:00+08:00',
    };

    const ics = formatOccupiedCalendarEventsAsIcs([booking, block, external], new Date('2026-08-28T00:00:00Z'));

    expect((ics.match(/BEGIN:VEVENT/g) ?? [])).toHaveLength(2);
    expect(ics).toContain('SUMMARY:剪髮・林客人');
    expect(ics).toContain('SUMMARY:不可接案：研習');
    expect(ics).not.toContain('外部來源');
  });
});
