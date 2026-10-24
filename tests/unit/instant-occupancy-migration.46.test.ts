import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILE = 'supabase/migrations/0138_issue_46_instant_occupancy.sql';
const sql = readFileSync(FILE, 'utf8');
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

function fn(name: string): string {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\$\\$;|create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)end;\\s*\\$\\$\\s+language`, 'i');
  const m = re.exec(code);
  expect(m, `function ${name} not found`).not.toBeNull();
  return m![0];
}

describe('#46 0138 INSTANT occupancy migration 原始碼守門', () => {
  it('編號是現存最大號＋1（無碰撞）', () => {
    const numbers = readdirSync('supabase/migrations').filter((f) => /^\d{4}_/.test(f)).map((f) => f.slice(0, 4));
    expect(numbers.filter((n) => n === '0138')).toHaveLength(1);
    expect(Math.max(...numbers.map(Number))).toBe(138);
  });

  it('單一交易（begin/commit）且含 PB-026 形狀斷言', () => {
    expect(code).toMatch(/^\s*begin;/m);
    expect(code).toMatch(/^\s*commit;\s*$/m);
    expect(code).toMatch(/0138 形狀斷言失敗/);
    expect(code).toMatch(/0138 後置斷言失敗/);
  });

  it('duration snapshot：nullable int、check > 0、保守回填只在行程時長已知時、先回填後建 trigger', () => {
    expect(code).toMatch(/add column if not exists duration_minutes_snapshot integer;/i);
    expect(code).toMatch(/check \(duration_minutes_snapshot is null or duration_minutes_snapshot > 0\)/i);
    expect(code).toMatch(/greatest\(pl\.duration_minutes, round\(t\.duration_hours \* 60\)::integer\)/);
    expect(code).toMatch(/t\.duration_hours is not null and t\.duration_hours > 0/);
    expect(code.indexOf('update public.trip_departures d')).toBeLessThan(code.indexOf('create constraint trigger trg_bookings_staff_occupancy'));
  });

  it('trip_plans INSTANT 規則欄位：預設 1440／60、導遊為同租戶複合 FK、非 INSTANT 不強制', () => {
    expect(code).toMatch(/instant_start_times time\[\]/);
    expect(code).toMatch(/instant_min_lead_minutes integer not null default 1440/);
    expect(code).toMatch(/instant_max_advance_days integer not null default 60/);
    expect(code).toMatch(/foreign key \(tenant_id, instant_guide_staff_id\) references public\.staff \(tenant_id, id\)/);
    expect(code).not.toMatch(/sales_mode\s*(<>|=)\s*'INSTANT'[^;]*check/i);
  });

  it('三個 writer 皆有 constraint trigger，且共用 per-(tenant,staff) advisory lock', () => {
    for (const [table, trg] of [['bookings', 'trg_bookings_staff_occupancy'], ['trip_departure_staff', 'trg_trip_departure_staff_occupancy'], ['trip_departures', 'trg_trip_departures_staff_occupancy']]) {
      expect(code).toMatch(new RegExp(`create constraint trigger ${trg}[\\s\\S]*?on public\\.${table}[\\s\\S]*?deferrable initially immediate[\\s\\S]*?for each row execute function public\\.${trg}\\(\\)`));
    }
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('staff-occupancy:'/);
    expect(fn('assert_staff_not_occupied')).toMatch(/lock_staff_occupancy/);
  });

  it('衝突 raise STAFF_OCCUPIED（P0020），檢查排除自己，且只看 PENDING/CONFIRMED 預約與非 CANCELLED 團次', () => {
    const body = fn('assert_staff_not_occupied');
    expect(body).toMatch(/raise exception 'STAFF_OCCUPIED' using errcode = 'P0020'/);
    expect(body).toMatch(/b\.status in \('PENDING', 'CONFIRMED'\)/);
    expect(body).toMatch(/d\.status <> 'CANCELLED'/);
    expect(body).toMatch(/b\.id is distinct from p_except_booking/);
    expect(body).toMatch(/d\.id is distinct from p_except_departure/);
  });

  it('多人團次依 staff id 排序取鎖；trigger 只重驗新／變更列（不追溯）', () => {
    expect(fn('trg_trip_departures_staff_occupancy')).toMatch(/order by ds\.staff_id/);
    expect(fn('trg_bookings_staff_occupancy')).toMatch(/old\.staff_id is not distinct from new\.staff_id/);
    expect(fn('trg_trip_departure_staff_occupancy')).toMatch(/old\.staff_id = new\.staff_id and old\.departure_id = new\.departure_id/);
    expect(code).not.toMatch(/exclude\s+using/i);
  });

  it('trigger 與 helper 皆 security invoker（避免 0136 的 owner-RLS 靜默漏判），helper 不給 anon/PUBLIC', () => {
    expect(code).not.toMatch(/security definer[\s\S]{0,40}trg_/i);
    for (const name of ['assert_staff_not_occupied', 'trg_bookings_staff_occupancy', 'tenant_timezone_name']) {
      expect(fn(name)).toMatch(/security invoker/i);
      expect(fn(name)).not.toMatch(/security definer/i);
    }
    expect(code).toMatch(/revoke all on function public\.assert_staff_not_occupied\(uuid, uuid, tstzrange, uuid, uuid\) from public, anon;/);
  });

  it('create_instant_tour_order：invoker、service_role only、單一交易內依序做完所有步驟', () => {
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/security invoker/i);
    expect(body).not.toMatch(/security definer/i);
    const order = ['pg_advisory_xact_lock', "'INSTANT'", 'instant_wall_clock_ambiguous', '= any (v_plan.instant_start_times)', 'instant_min_lead_minutes',
      'instant_max_advance_days', 'lock_staff_occupancy', "raise exception 'SLOT_TAKEN'", 'guide_staff_interval_available',
      'replace_trip_departure_staff', 'request_hold_hours', 'create_tour_order_quoted', 'idempotency_key = p_idempotency_key', "set status = 'CLOSED'"];
    let last = -1;
    for (const token of order) {
      const at = body.indexOf(token, last + 1);
      expect(at, `步驟 ${token} 缺漏或順序錯誤`).toBeGreaterThan(last);
      last = at;
    }
    expect(body).toMatch(/'INSTANT_NOT_CONFIGURED'[\s\S]*?P0024|errcode = 'P0024'/);
    expect(body).toMatch(/'PRIVATE'/);
    expect(body).toMatch(/exception when unique_violation then[\s\S]*?SLOT_TAKEN/);
    const grants = code.match(/grant\s+execute\s+on\s+function\s+public\.create_instant_tour_order\([\s\S]*?;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/to\s+service_role;$/i);
    expect(code).toMatch(/revoke\s+all\s+on\s+function\s+public\.create_instant_tour_order\([\s\S]*?from\s+anon,\s*authenticated;/i);
  });

  it('保留期限 snapshot 來自 trip_plans.request_hold_hours（單一來源），不硬編碼 12', () => {
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/v_plan\.request_hold_hours::double precision \* interval '1 hour'/);
    expect(body).not.toMatch(/\b12\b/);
  });

  it('0135 predicate 改讀 snapshot：不再引用 pl.duration_minutes，ACL 維持 service_role only', () => {
    const body = fn('guide_staff_interval_available');
    expect(body).toMatch(/d\.duration_minutes_snapshot/);
    expect(body).not.toMatch(/pl\.duration_minutes/);
    expect(code).toMatch(/revoke all on function public\.guide_staff_interval_available\(uuid,uuid,timestamptz,timestamptz\) from public,anon,authenticated;/);
    expect(code).toMatch(/grant execute on function public\.guide_staff_interval_available\(uuid,uuid,timestamptz,timestamptz\) to service_role;/);
  });

  it('cancel／expire：簽章不變、保留 seats_reserved 守門，並釋放 INSTANT 私人團', () => {
    for (const name of ['cancel_tour_order', 'expire_tour_order']) {
      const body = fn(name);
      expect(body).toMatch(/if v_order\.seats_reserved then/);
      expect(body).toMatch(/pl\.sales_mode = 'INSTANT' and pl\.participation_mode = 'PRIVATE'/);
      expect(body).toMatch(/set status = 'CANCELLED'/);
      expect(body).toMatch(/not exists \(select 1 from public\.tour_orders o2/);
    }
    expect(fn('cancel_tour_order')).toMatch(/cancel_tour_order\(\s*p_tenant uuid,\s*p_order\s+uuid,\s*p_reason text\s*\)/);
    expect(fn('expire_tour_order')).toMatch(/hold_expires_at < now\(\)/);
    expect(code).not.toMatch(/create or replace function public\.create_tour_order\s*\(/i);
  });

  it('冪等：tour_orders.idempotency_key＋(tenant,key) partial unique index', () => {
    expect(code).toMatch(/create unique index if not exists ux_tour_orders_tenant_idempotency\s+on public\.tour_orders \(tenant_id, idempotency_key\) where idempotency_key is not null;/);
  });
});
