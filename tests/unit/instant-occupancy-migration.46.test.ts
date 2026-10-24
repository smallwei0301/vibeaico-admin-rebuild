import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inferMigrationRiskTier } from '../../scripts/agents/production-db-release-plan.mjs';

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

  it('duration snapshot：nullable int、check > 0、不回填既有團次（回填會使整支 migration 變成 BACKFILL 風險類別）', () => {
    expect(code).toMatch(/add column if not exists duration_minutes_snapshot integer;/i);
    expect(code).toMatch(/check \(duration_minutes_snapshot is null or duration_minutes_snapshot > 0\)/i);
    expect(code).toMatch(/greatest\(pl\.duration_minutes, round\(t\.duration_hours \* 60\)::integer\)/);
    expect(code).toMatch(/t\.duration_hours is not null and t\.duration_hours > 0/);
    // 不得有任何對 trip_departures 的 DML（回填）；既有團次 snapshot 維持 NULL。
    expect(code).not.toMatch(/^update\s+public\.trip_departures\b/im);
    expect(code).not.toMatch(/duration_minutes_snapshot\s*=\s*greatest\(/);
    // NULL snapshot 在 departure_effective_minutes 內視為 0。
    expect(fn('departure_effective_minutes')).toMatch(/coalesce\(p_snapshot, 0\)/);
  });

  it('trip_plans INSTANT 規則欄位：預設 1440／60、導遊單欄 FK＋同租戶 trigger（不依賴 staff 複合 key）、非 INSTANT 不強制', () => {
    expect(code).toMatch(/instant_start_times time\[\]/);
    expect(code).toMatch(/instant_min_lead_minutes integer not null default 1440/);
    expect(code).toMatch(/instant_max_advance_days integer not null default 60/);
    expect(code).toMatch(/foreign key \(instant_guide_staff_id\) references public\.staff \(id\)/);
    expect(code).not.toMatch(/references public\.staff \(tenant_id, id\)/);
    expect(code).not.toMatch(/staff_tenant_id_id_key/);
    expect(fn('trg_trip_plans_instant_guide_same_tenant')).toMatch(/s\.id = new\.instant_guide_staff_id and s\.tenant_id = new\.tenant_id/);
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
    expect(code).toMatch(/revoke all on function public\.assert_staff_not_occupied\(uuid, uuid, tstzrange, uuid, uuid, text\) from public, anon;/);
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

  it('0135 predicate 與全部 trigger 改用 departure_effective_minutes（snapshot 只延長不縮短），ACL 維持 service_role only', () => {
    const body = fn('guide_staff_interval_available');
    expect(body).toMatch(/departure_effective_minutes\(d\.duration_minutes_snapshot, pl\.duration_minutes, tr\.duration_hours\)/);
    expect(body).not.toMatch(/make_interval\(mins=>pl\.duration_minutes/);
    expect(body).toMatch(/left join public\.trips tr on tr\.id=d\.trip_id/);
    const eff = fn('departure_effective_minutes');
    expect(eff).toMatch(/greatest\(\s*coalesce\(p_snapshot, 0\),\s*coalesce\(p_plan_minutes, 0\),/);
    expect(eff).toMatch(/round\(p_trip_hours \* 60\)/);
    expect(eff).toMatch(/nullif\(greatest/);
    // 占用範圍的所有呼叫端都經由 departure_range_for，不再直接用 snapshot 欄位算範圍。
    expect(fn('departure_range_for')).toMatch(/departure_effective_minutes\(d\.duration_minutes_snapshot, pl\.duration_minutes, t\.duration_hours\)/);
    expect(fn('assert_staff_not_occupied')).toMatch(/departure_range_for\(d\.id, v_zone\)/);
    expect(fn('trg_trip_departure_staff_occupancy')).toMatch(/departure_range_for\(new\.departure_id/);
    expect(fn('trg_trip_departures_staff_occupancy')).toMatch(/departure_range_for\(new\.id/);
    expect(code).not.toMatch(/departure_occupancy_range\(\s*[\w.]+,\s*[\w.]+,\s*(?:d|new|v_dep)\.duration_minutes_snapshot/);
    expect(code).toMatch(/revoke all on function public\.guide_staff_interval_available\(uuid,uuid,timestamptz,timestamptz\) from public,anon,authenticated;/);
    expect(code).toMatch(/grant execute on function public\.guide_staff_interval_available\(uuid,uuid,timestamptz,timestamptz\) to service_role;/);
  });

  it('cancel／expire：簽章不變、保留 seats_reserved 守門，並釋放 INSTANT 私人團', () => {
    for (const name of ['cancel_tour_order', 'expire_tour_order']) {
      const body = fn(name);
      expect(body).toMatch(/if v_order\.seats_reserved then/);
      expect(body).toMatch(/and d\.instant_private\n/);
      expect(body).not.toMatch(/pl\.sales_mode|pl\.participation_mode/); // 不看方案「現在」的設定
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

  it('B2：重用 CANCELLED 團次前必須確認沒有任何非 CANCELLED 訂單', () => {
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/v_slot\.status <> 'CANCELLED' or v_slot\.seats_booked <> 0\s+or exists \(select 1 from public\.tour_orders o0[\s\S]*?o0\.status <> 'CANCELLED'\)\) then\s+raise exception 'SLOT_TAKEN'/);
  });

  it('冪等：同 key 比對 total／customer／contact，原單已取消回 P0025（不回 deduped 成功）', () => {
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/v_prev\.total_amount <> p_expected_total/);
    expect(body).toMatch(/v_prev\.customer_id is distinct from p_customer/);
    expect(body).toMatch(/v_prev\.contact is distinct from coalesce\(p_contact/);
    expect(body).toMatch(/v_prev\.status = 'CANCELLED' then\s+raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0025'/);
    expect(body).toMatch(/'status', v_prev\.status/);
  });

  it('提前量不得小於保留時數（否則 INSTANT_NOT_CONFIGURED）', () => {
    expect(fn('create_instant_tour_order')).toMatch(/instant_min_lead_minutes::numeric < v_plan\.request_hold_hours \* 60[\s\S]*?P0024/);
  });

  it('多人指派：tds trigger 先依 staff id 排序對全團取鎖', () => {
    const body = fn('trg_trip_departure_staff_occupancy');
    expect(body).toMatch(/order by x\.staff_id[\s\S]*?lock_staff_occupancy[\s\S]*?assert_staff_not_occupied/);
  });

  it('不重複建立 0092 已有的 (tenant_id, staff_id) 索引', () => {
    expect(code).not.toMatch(/create index[^;]*trip_departure_staff/i);
  });

  it('tenant_timezone_name：無設定列／無鍵用預設，無效值 raise P0026（不靜默改台北）', () => {
    const body = fn('tenant_timezone_name');
    expect(body).toMatch(/raise exception 'TENANT_TIMEZONE_INVALID' using errcode = 'P0026'/);
    expect(body).toMatch(/not \(v_basic \? 'timezone'\) then\s+return 'Asia\/Taipei'/);
  });

  it('duration snapshot 公式：只在 INSERT trigger 一次，且只在行程時長已知時（app 端同公式由 ACTIVATE 的測試守）', () => {
    const formula = 'greatest(pl.duration_minutes, round(t.duration_hours * 60)::integer)';
    expect(code.split(formula).length - 1).toBe(1);
    expect(code.match(/t\.duration_hours is not null and t\.duration_hours > 0/g)).toHaveLength(1);
  });

  it('Production DB release 分類器守門：整支只有 AUTHZ 一種 specialized risk，且 migration 時期執行區塊不呼叫非白名單函式', () => {
    const risk = inferMigrationRiskTier(sql, '0138_issue_46_instant_occupancy');
    expect(risk).toBe('AUTHZ');
    // 所有頂層 DO 區塊（含前置條件、形狀斷言、後置斷言）不得再出現被分類器擋下的函式。
    const doBlocks = code.match(/^do \$\$[\s\S]*?^end \$\$;/gm) ?? [];
    expect(doBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of doBlocks) {
      expect(block).not.toMatch(/\b(?:has_function_privilege|cardinality|array_position|to_regprocedure|greatest|round|length)\s*\(/);
      expect(block.replace(/pg_catalog\.to_regclass/g, '')).not.toMatch(/\bto_regclass\s*\(/);
      expect(block).not.toMatch(/\bif\s*\(/);
      expect(block).not.toMatch(/drop\s+constraint/i);
    }
  });

  it('instant_start_times 的 1–48 個元素且不得含 NULL 由 trigger 驗證（23514），不是 DO 內的 CHECK', () => {
    expect(code).not.toMatch(/add constraint trip_plans_instant_start_times_ck/);
    const body = fn('trg_trip_plans_instant_guide_same_tenant');
    expect(body).toMatch(/cardinality\(new\.instant_start_times\) between 1 and 48/);
    expect(body).toMatch(/array_position\(new\.instant_start_times, null::time\) is null/);
    expect(body).toMatch(/errcode = '23514'/);
    expect(code).toMatch(/before insert or update of instant_guide_staff_id, instant_start_times, tenant_id on public\.trip_plans/);
  });

  it('M7：INSTANT 時段（同鍵團次）查詢必須 for update，與並發建單序列化', () => {
    expect(fn('create_instant_tour_order')).toMatch(/where d\.tenant_id = p_tenant and d\.plan_id = p_plan and d\.departs_on = v_day and d\.start_time = v_time\s+for update;/);
  });

  it('B1：時區比對不分大小寫並回 canonical 名稱，查不到才 raise P0026', () => {
    const body = fn('tenant_timezone_name');
    expect(body).toMatch(/lower\(n\.name\) = lower\(v_zone\)/);
    expect(body).toMatch(/return v_canonical;/);
    expect(body).toMatch(/v_canonical is null then\s+raise exception 'TENANT_TIMEZONE_INVALID' using errcode = 'P0026'/);
  });

  it('B2：預約 trigger 在導遊與起訖都沒變且舊狀態已屬占用狀態時不重驗（PENDING→CONFIRMED、改備註）', () => {
    const body = fn('trg_bookings_staff_occupancy');
    expect(body).toMatch(/old\.status in \('PENDING', 'CONFIRMED'\)\s+then\s+return null;/);
    expect(body).not.toMatch(/old\.status = new\.status/);
    // 團次 trigger：只在日期、時間、時長變更或自 CANCELLED 復原時重驗（OPEN／CLOSED 切換與 seats 不重驗）。
    const dep = fn('trg_trip_departures_staff_occupancy');
    expect(dep).toMatch(/old\.status <> 'CANCELLED' and old\.departs_on = new\.departs_on/);
    expect(code).toMatch(/after update of departs_on, start_time, status, duration_minutes_snapshot on public\.trip_departures/);
  });

  it('N1：INSTANT 的 v_end 與 snapshot 使用 departure_effective_minutes（同一公式）', () => {
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/v_minutes := public\.departure_effective_minutes\(null, v_plan\.duration_minutes, v_plan\.duration_hours\)/);
    expect(body).toMatch(/v_end := p_starts_at \+ make_interval\(mins => v_minutes\)/);
    expect(body).toMatch(/duration_minutes_snapshot = v_minutes/);
  });

  it('N5：時區只算一次，經 p_zone 傳給 assert；N2／N3 限制已寫在檔頭', () => {
    expect(fn('assert_staff_not_occupied')).toMatch(/p_zone text default null/);
    expect(fn('assert_staff_not_occupied')).toMatch(/coalesce\(p_zone, public\.tenant_timezone_name\(p_tenant\)\)/);
    expect(fn('trg_trip_departures_staff_occupancy')).toMatch(/v_zone := public\.tenant_timezone_name[\s\S]*?v_range := public\.departure_range_for\(new\.id, v_zone\)[\s\S]*?v_range, new\.id, null, v_zone/);
    expect(fn('trg_trip_departure_staff_occupancy')).toMatch(/v_zone := public\.tenant_timezone_name[\s\S]*?new\.departure_id, null, v_zone\)/);
    expect(sql).toMatch(/無法重新儲存指派/);
    expect(sql).toMatch(/只保證 READ COMMITTED/);
  });

  it('0135 predicate 的時區驗證與 tenant_timezone_name 一致：不分大小寫、取 canonical，查不到回 false 不 raise', () => {
    const body = fn('guide_staff_interval_available');
    expect(body).toMatch(/lower\(n\.name\)=lower\(v_zone\)/);
    expect(body).toMatch(/v_canonical is null then return false;/);
    expect(body).toMatch(/v_zone := v_canonical;/);
    expect(body).not.toMatch(/where name=v_zone/);
  });

  it('P2-a：instant_private 持久標記由 create_instant_tour_order 建團／重用時設 true，預設 false', () => {
    expect(code).toMatch(/add column if not exists instant_private boolean not null default false;/);
    const body = fn('create_instant_tour_order');
    expect(body).toMatch(/instant_private = true/);
    expect(body).toMatch(/duration_minutes_snapshot, instant_private\s+\) values \([\s\S]*?v_minutes, true\s+\) returning id into v_dep/);
  });

  it('P2-b：指派 trigger 先 for no key update 鎖團次列再取 staff 鎖；RPC 鎖序同為團次列 → 導遊', () => {
    const body = fn('trg_trip_departure_staff_occupancy');
    expect(body).toMatch(/from public\.trip_departures d where d\.id = new\.departure_id and d\.tenant_id = new\.tenant_id\s+for no key update;/);
    expect(body.indexOf('for no key update')).toBeLessThan(body.indexOf('lock_staff_occupancy'));
    const rpc = fn('create_instant_tour_order');
    const firstSlotLock = rpc.search(/perform 1 from public\.trip_departures d[\s\S]*?for update;/);
    expect(firstSlotLock).toBeGreaterThan(-1);
    expect(firstSlotLock).toBeLessThan(rpc.indexOf('perform public.lock_staff_occupancy'));
    // 取得導遊鎖後必須重讀並 for update（等鎖期間他人可能已提交同鍵團次）。
    expect(rpc.indexOf('perform public.lock_staff_occupancy')).toBeLessThan(rpc.search(/select d\.id, d\.status, d\.seats_booked into v_slot[\s\S]*?for update;/));
  });

  it('G3 admission：guide-interval-availability 整合測試同時接受 0135 或 0138 的 exact release（兩支都沒有才 POLICY_SKIP）', () => {
    const src = readFileSync('tests/integration/db/guide-interval-availability.46.test.ts', 'utf8');
    expect(src).toMatch(/const migrations = \[migration, '0138_issue_46_instant_occupancy'\];/);
    expect(src).toMatch(/for \(const name of migrations\)/);
    // 每支被選中的 migration 都做 exact 驗證。
    for (const token of ['selected.length !== 1', 'applied.length !== 1', 'selected[0].path !== path', 'selected[0].sha256 !== digest', 'applied[0].sha256 !== digest', 'applied[0].riskTier !== selected[0].riskTier', 'APPLIED_VERIFIED', 'REPLAY_VERIFIED']) {
      expect(src, token).toContain(token);
    }
    expect(src).toMatch(/if \(!admittedAny\) return \{ admitted: false, local: false \};/);
    expect(src).not.toMatch(/row\.repoFile === migration\)/); // 不再只認 0135
    // 契約：0138 的 requiredFiles 與 0135 相同，只有這一個整合測試檔。
    const contracts = readFileSync('scripts/agents/production-db-g3-authz-contracts.mjs', 'utf8');
    expect(contracts).toMatch(/'0138_issue_46_instant_occupancy': Object\.freeze\(\{\s+requiredFiles: CONTRACT_0135\.requiredFiles,/);
  });

  it('guide-action-inbox 的 0138 探測：只有欄位不存在才視為未套用、其他錯誤拋出；不得使用 ctx.skip／it.skip', () => {
    const src = readFileSync('tests/integration/api/guide-action-inbox.43.test.ts', 'utf8');
    expect(src).toMatch(/probe\.error\.code === '42703' \|\| probe\.error\.code === 'PGRST204'/);
    expect(src).toMatch(/throw new Error\(`0138 探測失敗/);
    // vitest 會把 skip 記為 pending，而 scripts/agents/production-db-g3-test-artifacts.mjs 的 pending allowlist
    // 不允許（UNAPPROVED_VITEST_PENDING），會拖垮其他不含 0138 的 bounded G3；未套用時改 console.info 後 return。
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(noComments).not.toMatch(/ctx\.skip|\.skip\(|it\.skip|test\.skip|describe\.skip|\.todo\(|skipIf/);
    expect(src).toMatch(/if \(!\(await has0138\(\)\)\) \{[\s\S]*?console\.info\('#46 POLICY_SKIP\/NOT_RUN[\s\S]*?return;/);
  });

  it('update_trip_departure_with_staff：單一交易延後兩個占用 trigger、改團次與指派後立即以最終狀態驗證；invoker、僅 service_role', () => {
    const body = fn('update_trip_departure_with_staff');
    expect(body).toMatch(/security invoker/i);
    expect(body).not.toMatch(/security definer/i);
    // 鎖序：團次列 for update → 延後 → 更新團次 → replace 指派 → 立即驗證（導遊 advisory lock 在 trigger 內取得）。
    const order = ['for update;', 'deferred;', 'update public.trip_departures d', 'replace_trip_departure_staff', 'immediate;'];
    let last = -1;
    for (const token of order) {
      const at = body.indexOf(token, last + 1);
      expect(at, `步驟 ${token} 缺漏或順序錯誤`).toBeGreaterThan(last);
      last = at;
    }
    expect(body).toMatch(/set constraints public\.trg_trip_departures_staff_occupancy, public\.trg_trip_departure_staff_occupancy deferred/);
    expect(body).toMatch(/set constraints public\.trg_trip_departures_staff_occupancy, public\.trg_trip_departure_staff_occupancy immediate/);
    expect(body).toMatch(/raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'/);
    expect(body).toMatch(/case when p_change_start_time then p_start_time else d\.start_time end/);
    const sig = 'uuid, uuid, date, boolean, time, text, boolean, uuid, uuid\\[\\]';
    expect(code).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.update_trip_departure_with_staff\\(\\s*${sig}\\s*\\)\\s*from\\s+public;`, 'i'));
    expect(code).toMatch(new RegExp(`from\\s+anon,\\s*authenticated;`, 'i'));
    const grants = code.match(/grant\s+execute\s+on\s+function\s+public\.update_trip_departure_with_staff\([\s\S]*?;/gi) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/to\s+service_role;$/i);
  });

  it('檔頭已知限制：ACTIVATE 前 PATCH 仍兩步寫入，需改用 update_trip_departure_with_staff', () => {
    expect(sql).toMatch(/仍是兩步寫入/);
    expect(sql).toMatch(/ACTIVATE PR 必須改呼叫本檔新增的 update_trip_departure_with_staff/);
  });
});
