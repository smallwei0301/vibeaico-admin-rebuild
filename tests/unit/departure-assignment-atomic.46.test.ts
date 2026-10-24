import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => ({ rpc: state.rpc }) }));

import { ApiHttpError, ERR, STAFF_OCCUPIED_MESSAGE } from '@/server/http';
import { discardUnassignedDeparture, departureSlot, isStaffOccupiedError, writeAssignment } from '@/server/departure-staff';
import { departureSnapshotMinutes } from '@/server/staff-availability';

const A = { primaryStaffId: 's1', assistantStaffIds: ['s2'] };

beforeEach(() => state.rpc.mockReset());

describe('#46 writeAssignment 改走 replace_trip_departure_staff（刪插同一交易）', () => {
  it('以 RPC 傳 primary 與 assistants，不再分兩次 delete／insert', async () => {
    state.rpc.mockResolvedValue({ error: null });
    const from = vi.fn();
    await writeAssignment({ from } as never, 't', 'd', A);
    expect(state.rpc).toHaveBeenCalledWith('replace_trip_departure_staff', {
      p_tenant: 't', p_departure: 'd', p_primary: 's1', p_assistants: ['s2'],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('P0020／STAFF_OCCUPIED → 409 ERR.STAFF_OCCUPIED「導遊該時段已有安排」', async () => {
    state.rpc.mockResolvedValue({ error: { code: 'P0020', message: 'STAFF_OCCUPIED' } });
    const err = await writeAssignment({} as never, 't', 'd', A).catch((e) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).toMatchObject({ status: 409, code: ERR.STAFF_OCCUPIED, message: STAFF_OCCUPIED_MESSAGE });
    expect(STAFF_OCCUPIED_MESSAGE).toBe('導遊該時段已有安排');
  });

  it('重複指派 → 409 CONFLICT；未知錯誤原樣拋出', async () => {
    state.rpc.mockResolvedValueOnce({ error: { code: 'P0003', message: 'DUPLICATE_STAFF_ASSIGNMENT' } });
    await expect(writeAssignment({} as never, 't', 'd', A)).rejects.toMatchObject({ status: 409, code: ERR.CONFLICT });
    const boom = { code: 'XX000', message: 'boom' };
    state.rpc.mockResolvedValueOnce({ error: boom });
    await expect(writeAssignment({} as never, 't', 'd', A)).rejects.toBe(boom);
  });

  it('isStaffOccupiedError 同時認 SQLSTATE 與 message', () => {
    expect(isStaffOccupiedError({ code: 'P0020' })).toBe(true);
    expect(isStaffOccupiedError({ message: 'x STAFF_OCCUPIED y' })).toBe(true);
    expect(isStaffOccupiedError({ code: '23505' })).toBe(false);
    expect(isStaffOccupiedError(null)).toBe(false);
  });

  it('discardUnassignedDeparture 刪除該租戶的團次；刪除失敗不拋出（由呼叫端拋原始錯誤）', async () => {
    const calls: Array<[string, string]> = [];
    const q: Record<string, unknown> = {};
    q.delete = () => q;
    q.eq = (k: string, v: string) => { calls.push([k, v]); return q; };
    q.then = (res: (v: unknown) => unknown) => res({ error: { message: 'x' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(discardUnassignedDeparture({ from: () => q } as never, 't', 'd')).resolves.toBeUndefined();
    expect(calls).toEqual([['tenant_id', 't'], ['id', 'd']]);
    spy.mockRestore();
  });
});

describe('#46 app／DB 時長公式一致（0138 snapshot）', () => {
  it('departureSnapshotMinutes = greatest(plan.duration_minutes, round(hours*60))，行程時長未知＝null', () => {
    expect(departureSnapshotMinutes(240, 2)).toBe(240); // Sol 反例：行程 2h、方案 240 分
    expect(departureSnapshotMinutes(60, 2)).toBe(120);
    expect(departureSnapshotMinutes(90, 1.5)).toBe(90);
    expect(departureSnapshotMinutes(60, 0.0001)).toBe(60);
    expect(departureSnapshotMinutes(240, null)).toBeNull();
    expect(departureSnapshotMinutes(240, 0)).toBeNull();
    expect(departureSnapshotMinutes(null, 2)).toBe(120);
  });

  it('migration 的回填與 INSERT trigger 使用同一個公式（與 TS 同步的守門）', () => {
    const sql = readFileSync('supabase/migrations/0138_issue_46_instant_occupancy.sql', 'utf8');
    const formula = 'greatest(pl.duration_minutes, round(t.duration_hours * 60)::integer)';
    expect(sql.split(formula).length - 1).toBe(2); // 回填 UPDATE 與 trigger 各一次
    expect(sql.match(/t\.duration_hours is not null and t\.duration_hours > 0/g)).toHaveLength(2);
    const src = readFileSync('src/server/staff-availability.ts', 'utf8');
    expect(src).toMatch(/Math\.max\(fromTrip, fromPlan\)/);
  });

  it('departureSlot：新團用方案＋行程公式，既有團讀自己的 snapshot', async () => {
    const make = (tables: Record<string, Record<string, unknown>>) => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        q.select = () => q; q.eq = () => q;
        q.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
        return q;
      },
    });
    const fresh = await departureSlot(make({ trips: { duration_hours: 2 }, trip_plans: { duration_minutes: 240 } }) as never,
      't', 'trip', '2026-10-27', '10:00', { planId: 'p' });
    expect(fresh.end - fresh.start).toBe(240 * 60_000);
    const existing = await departureSlot(make({ trip_departures: { duration_minutes_snapshot: 90 } }) as never,
      't', 'trip', '2026-10-27', '10:00', { departureId: 'd' });
    expect(existing.end - existing.start).toBe(90 * 60_000);
    const unknown = await departureSlot(make({ trip_departures: { duration_minutes_snapshot: null } }) as never,
      't', 'trip', '2026-10-27', '10:00', { departureId: 'd' });
    expect(unknown.wholeDay).toBe(true);
  });
});

describe('#46 route 接線守門', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  it('POST／batch 指派失敗時移除剛建的團次；PATCH 把團次 update 的 P0020 轉 409', () => {
    expect(read('src/app/api/trips/[id]/departures/route.ts')).toMatch(/catch \(e\) \{\s*await discardUnassignedDeparture/);
    const batch = read('src/app/api/trips/[id]/departures/batch/route.ts');
    expect(batch).toMatch(/await discardUnassignedDeparture/);
    expect(batch).toMatch(/e\.code === ERR\.STAFF_OCCUPIED/);
    expect(batch).toMatch(/departureSnapshotMinutes\(plan\.duration_minutes, durationHours\)/);
    expect(read('src/app/api/trip-departures/[id]/route.ts')).toMatch(/isStaffOccupiedError\(error\)\) return fail\(409, STAFF_OCCUPIED_MESSAGE/);
  });
});
