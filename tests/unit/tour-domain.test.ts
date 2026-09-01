import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addonCreateSchema,
  dateRange,
  departureBatchSchema,
  departureCreateSchema,
  planCreateSchema,
  slugFromTitle,
  tripCreateSchema,
  tripRow,
} from '@/server/tour-domain';
import { mapTrip, mapTripAddon, mapTripDeparture, mapTripPlan } from '@/server/mappers';

describe('tour-domain validation and row builders (#8-A)', () => {
  it('freezes only the four canonical core tables and their security contract', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0015_tour_domain_core.sql'), 'utf8');
    for (const table of ['trips', 'trip_plans', 'trip_departures', 'trip_addons']) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
    expect(sql).toContain('alter table public.%I enable row level security');
    expect(sql).toContain("create type public.trip_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED')");
    expect(sql).toContain("create type public.departure_status as enum ('OPEN', 'CLOSED', 'CANCELLED')");
    expect(sql).toContain('create index i_departures on public.trip_departures (tenant_id, trip_id, departs_on)');
    expect(sql).toContain('check (seats_booked >= 0 and seats_booked <= capacity)');
    expect(sql).toContain('is_tenant_member(tenant_id)');
    expect(sql).not.toMatch(/create table\s+tour_orders/i);
    expect(sql).not.toMatch(/create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?reserve_seats/i);
    expect(sql).not.toMatch(/create table\s+trip_departure_staff/i);
  });

  it('has guarded fresh-install and historical-drift reconciliation paths', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0015_tour_domain_core.sql'), 'utf8');
    expect(sql).toContain('add column if not exists location text');
    expect(sql).toContain('add column if not exists duration_hours numeric');
    expect(sql).toContain('add column if not exists includes text');
    expect(sql).toContain('add column if not exists notes text');
    expect(sql).toContain('add column if not exists price_per_person numeric');
    expect(sql).toContain('add column if not exists min_party integer');
    expect(sql).toContain('add column if not exists max_party integer');
    expect(sql).toContain('coalesce(price_per_person, base_price, 0)');
    expect(sql).toContain('coalesce(min_party, min_participants, 1)');
    expect(sql).toContain('sync_tour_plan_legacy_fields_0015');
    expect(sql).toContain('sync_tour_trip_legacy_fields_0015');
    expect(sql).toContain('to_regclass(\'public.i_departures\')');
    expect(sql).toContain('pg_policy');
    expect(sql).toContain('pg_trigger');
    expect(sql).toContain('alter type public.trip_status add value if not exists');
  });

  it('accepts the canonical trip payload and scopes the row to the supplied tenant', () => {
    const value = tripCreateSchema.parse({ title: '龜山島', slug: 'turtle-island', durationHours: 3 });
    expect(tripRow(value, 'tenant-a')).toMatchObject({
      tenant_id: 'tenant-a', slug: 'turtle-island', title: '龜山島', duration_hours: 3,
    });
  });

  it('rejects an empty trip title and invalid plan values', () => {
    expect(() => tripCreateSchema.parse({ title: '  ' })).toThrow();
    expect(() => planCreateSchema.parse({ name: '方案', pricePerPerson: -1 })).toThrow();
    expect(() => planCreateSchema.parse({ name: '方案', pricePerPerson: 100, minParty: 5, maxParty: 2 })).toThrow();
  });

  it('rejects invalid dates, duplicate weekdays, negative addon price and stock', () => {
    expect(() => departureCreateSchema.parse({
      planId: '7a000000-0000-4000-8000-000000000011', departsOn: '2026-02-30', capacity: 2,
    })).toThrow();
    expect(() => departureBatchSchema.parse({
      planId: '7a000000-0000-4000-8000-000000000011', from: '2026-09-01', to: '2026-09-02',
      weekdays: [1, 1], capacity: 2,
    })).toThrow();
    expect(() => addonCreateSchema.parse({ name: '餐點', price: -1 })).toThrow();
    expect(() => addonCreateSchema.parse({ name: '餐點', stock: -1 })).toThrow();
  });

  it('expands an inclusive UTC date range without local-time drift', () => {
    expect(dateRange('2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03',
    ]);
  });

  it('creates a deterministic slug fallback for titles without latin characters', () => {
    expect(slugFromTitle('  龜山島賞鯨  ')).toBe('龜山島賞鯨');
    expect(slugFromTitle('!!!')).toMatch(/^trip-/);
  });
});

describe('canonical tour row mappers (#8-A)', () => {
  it('maps trips without inventing non-canonical persisted fields', () => {
    expect(mapTrip({
      id: 'trip-1', slug: 'trip', title: '行程', summary: '簡介', description: '內容',
      cover_image_url: 'cover', gallery: ['a.jpg'], location: '宜蘭', duration_hours: 3,
      meeting_point: '港口', includes: '船票\n飲水', notes: '注意', status: 'DRAFT',
      midao_listing: 'NONE', midao_listing_note: '', updated_at: '2026-09-01T00:00:00Z',
    })).toMatchObject({
      id: 'trip-1', region: '宜蘭', galleryUrls: ['a.jpg'], inclusions: ['船票', '飲水'],
      planCount: 0, upcomingDepartureCount: 0, minPrice: 0,
    });
  });

  it('maps canonical plan, departure and addon values including nulls', () => {
    expect(mapTripPlan({
      id: 'plan-1', trip_id: 'trip-1', name: '標準', price_per_person: '3000',
      child_price: null, min_party: 1, max_party: 10, deposit_mode: 'FULL', deposit_value: 0,
      sort_order: 0, active: true,
    }).basePrice).toBe(3000);
    expect(mapTripDeparture({
      id: 'dep-1', trip_id: 'trip-1', plan_id: 'plan-1', departs_on: '2026-09-03',
      start_time: null, capacity: 2, seats_booked: 0, status: 'OPEN', note: null,
      trip_plans: { name: '標準' },
    })).toMatchObject({ planName: '標準', startTime: '', seatsBooked: 0, note: '' });
    expect(mapTripAddon({
      id: 'addon-1', trip_id: 'trip-1', name: '接送', price: '0', unit: 'PER_GROUP',
      stock: null, active: true, sort_order: 1,
    })).toMatchObject({ price: 0, unit: 'PER_GROUP', stock: null });
  });
});
