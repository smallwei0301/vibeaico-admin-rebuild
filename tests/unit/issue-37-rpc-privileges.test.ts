import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0036_issue_37_rpc_execute_privileges.sql', 'utf8');

const signatures = [
  'lock_staff_availability\\(uuid, uuid\\[\\]\\)',
  'assert_staff_available\\(uuid, uuid\\[\\], timestamptz, timestamptz, uuid, uuid\\)',
  'save_trip_departure_with_staff\\(uuid, uuid, uuid, uuid, date, time, integer, text, text, uuid, uuid\\[\\]\\)',
  'create_trip_departures_batch_with_staff\\(uuid, uuid, uuid, date, date, smallint\\[\\], time, integer, uuid, uuid\\[\\]\\)',
  'create_booking_with_availability\\(uuid, uuid, uuid, uuid, timestamptz, text\\)',
  'update_booking_with_availability\\(uuid, uuid, timestamptz, uuid, text\\)',
  'complete_tour_order_with_performance\\(uuid, uuid\\)',
];

describe('issue #37 RPC execute privileges', () => {
  it('denies PUBLIC/anon and explicitly permits only authenticated for all seven RPCs', () => {
    for (const signature of signatures) {
      expect(migration).toMatch(new RegExp(`revoke execute on function public\\.${signature} from public;`, 'i'));
      expect(migration).toMatch(new RegExp(`revoke execute on function public\\.${signature} from anon;`, 'i'));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${signature} to authenticated;`, 'i'));
    }
    expect((migration.match(/from public;/gi) ?? [])).toHaveLength(7);
    expect((migration.match(/from anon;/gi) ?? [])).toHaveLength(7);
    expect((migration.match(/to authenticated;/gi) ?? [])).toHaveLength(7);
  });
});
