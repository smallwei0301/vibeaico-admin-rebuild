import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapTripDeparture, mapTripPlan } from '@/server/mappers';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0107_issue_41_formation_state_model.sql'),
  'utf8',
);

const planRow = (extra: Record<string, unknown> = {}) => ({
  id: 'plan-1', trip_id: 'trip-1', name: '標準團', description: '',
  price_per_person: 1280, child_price: null, min_party: 1, max_party: 8,
  deposit_mode: 'FULL', deposit_value: 0, sort_order: 1, active: true, ...extra,
});

const departureRow = (extra: Record<string, unknown> = {}) => ({
  id: 'dep-1', trip_id: 'trip-1', plan_id: 'plan-1', trip_plans: { name: '標準團' },
  departs_on: '2026-10-01', start_time: '09:00:00', capacity: 8, seats_booked: 0,
  status: 'OPEN', note: '', ...extra,
});

/*
 * 18 分冊 §1 最重要的一條：`min_party_size` 不能再同時代表「最低成團人數」。
 * 「1 人可報名、4 人成團、最多 8 人」必須能被表達成三個不同的數字。
 */
describe('#41 成團門檻與每筆訂單人數是兩個概念', () => {
  it('把 minParticipants 與 minToDepart 分開帶出來', () => {
    const plan = mapTripPlan(planRow({ min_party: 1, max_party: 8, min_to_depart: 4 }));
    expect(plan.minParticipants).toBe(1);
    expect(plan.maxParticipants).toBe(8);
    expect(plan.minToDepart).toBe(4);
  });

  it('0107 不得移除或改寫既有的 min_party', () => {
    expect(MIGRATION).toMatch(/add column if not exists min_to_depart int/);
    expect(MIGRATION).not.toMatch(/drop column[^\n]*min_party/i);
    expect(MIGRATION).not.toMatch(/rename column[^\n]*min_party/i);
    // migration 自己也有一條後置斷言守這件事
    expect(MIGRATION).toContain('trip_plans.min_party 不見了');
  });
});

describe('#41 Plan 販售規則的值域收斂', () => {
  it.each([
    ['FIXED_DEPARTURE', 'FIXED_DEPARTURE'],
    ['INSTANT', 'INSTANT'],
    ['REQUEST', 'REQUEST'],
  ])('保留合法的 sales_mode %s', (raw, expected) => {
    expect(mapTripPlan(planRow({ sales_mode: raw })).salesMode).toBe(expected);
  });

  /*
   * 收斂方向必須與 18 分冊 §1 的「預設組合」一致，而且與 0107 的 DEFAULT 同一組。
   * 兩邊若各自漂移，同一筆資料在 mock 與真實後端兩條路徑下會顯示成不同的規則。
   */
  it.each([undefined, null, '', 'fixed_departure', 'SOMETHING', 7])(
    '把不合法的 sales_mode %s 收斂成 FIXED_DEPARTURE',
    (raw) => {
      expect(mapTripPlan(planRow({ sales_mode: raw })).salesMode).toBe('FIXED_DEPARTURE');
    },
  );

  it('participationMode 只認 PRIVATE，其餘一律 SHARED', () => {
    expect(mapTripPlan(planRow({ participation_mode: 'PRIVATE' })).participationMode).toBe('PRIVATE');
    for (const raw of [undefined, null, '', 'private', 'SHARED', 'OTHER']) {
      expect(mapTripPlan(planRow({ participation_mode: raw })).participationMode).toBe('SHARED');
    }
  });

  it('成團門檻與截止天數的預設與 0107 相同', () => {
    const plan = mapTripPlan(planRow());
    expect(plan.minToDepart).toBe(1);
    expect(plan.formationDeadlineDaysBefore).toBe(7);
    expect(MIGRATION).toMatch(/min_to_depart int not null default 1/);
    expect(MIGRATION).toMatch(/formation_deadline_days_before int not null default 7/);
  });

  /* §2.1：0 是合法的專業用法（募集到出發日），不得被當成「沒設定」而吃掉。 */
  it('保留 formationDeadlineDaysBefore = 0', () => {
    expect(mapTripPlan(planRow({ formation_deadline_days_before: 0 })).formationDeadlineDaysBefore).toBe(0);
  });
});

describe('#41 Departure 的成團狀態是另一條軸', () => {
  it.each(['COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED'])(
    '保留合法的 formation_status %s',
    (raw) => {
      expect(mapTripDeparture(departureRow({ formation_status: raw })).formationStatus).toBe(raw);
    },
  );

  /*
   * 未知值收斂成 COLLECTING 是刻意的 fail-closed 方向：「還在募集」不會讓 UI
   * 誤宣稱一團已經成立。收斂成 FORMED 才是危險的那一邊。
   */
  it.each([undefined, null, '', 'formed', 'UNKNOWN', 3])(
    '把不合法的 formation_status %s 收斂成 COLLECTING 而不是 FORMED',
    (raw) => {
      expect(mapTripDeparture(departureRow({ formation_status: raw })).formationStatus).toBe('COLLECTING');
    },
  );

  it('status 與 formationStatus 互不覆寫', () => {
    const closedButFormed = mapTripDeparture(departureRow({ status: 'CLOSED', formation_status: 'FORMED' }));
    expect(closedButFormed.status).toBe('CLOSED');
    expect(closedButFormed.formationStatus).toBe('FORMED');

    const openAndFormed = mapTripDeparture(departureRow({ status: 'OPEN', formation_status: 'FORMED' }));
    expect(openAndFormed.status).toBe('OPEN');
    expect(openAndFormed.formationStatus).toBe('FORMED');
  });

  it('帶出一次性成團證據；未成團時為 null', () => {
    const formed = mapTripDeparture(departureRow({
      formation_status: 'FORMED', formed_at: '2026-09-20T02:00:00Z',
      formed_by: 'GUIDE_OVERRIDE', formed_participants: 5,
    }));
    expect(formed.formedAt).toBe('2026-09-20T02:00:00Z');
    expect(formed.formedBy).toBe('GUIDE_OVERRIDE');
    expect(formed.formedParticipants).toBe(5);

    const collecting = mapTripDeparture(departureRow());
    expect(collecting.formedAt).toBeNull();
    expect(collecting.formedBy).toBeNull();
    expect(collecting.formedParticipants).toBeNull();
  });

  it.each([undefined, null, '', 'system', 'OTHER'])('把不合法的 formed_by %s 收斂成 null', (raw) => {
    expect(mapTripDeparture(departureRow({ formed_by: raw })).formedBy).toBeNull();
  });
});

/*
 * 這一組不是在測 SQL 執行結果——那要真實資料庫，由 agent-schema-bootstrap 負責。
 * 這裡守的是「migration 文字裡確實寫了這些不變量」，避免它們在後續編輯中被悄悄拿掉。
 */
describe('#41 0107 的資料庫層不變量', () => {
  it.each([
    ['成團證據齊全', 'trip_departures_formed_evidence_ck'],
    ['門檻不得超過容量', 'trip_departures_min_to_depart_ck'],
    ['販售方式值域', 'trip_plans_sales_mode_ck'],
    ['團型值域', 'trip_plans_participation_mode_ck'],
    ['截止天數 0–90', 'trip_plans_formation_deadline_days_ck'],
  ])('保留 %s 的 CHECK', (_label, name) => {
    expect(MIGRATION).toContain(name);
  });

  it('成團證據的 CHECK 同時涵蓋 FORMED 與 AT_RISK', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('trip_departures_formed_evidence_ck'));
    const check = block.slice(0, block.indexOf('end if;'));
    expect(check).toContain("'FORMED'");
    expect(check).toContain("'AT_RISK'");
  });

  it('capacity < 1 時指名報錯，而不是把資料改成能通過檢查的樣子', () => {
    expect(MIGRATION).toContain('本 migration 不會替它們決定一個容量');
    expect(MIGRATION).not.toMatch(/update public\.trip_departures\s+set capacity/i);
  });

  /*
   * Owner 2026-09-14：不採用 TEST 的歷史 #41 overlay。檔頭**指名**它是對的——
   * 那是在說明「不採用哪一個」，不是在引用它。要守的是檔名不重用 0040 前綴，
   * 以及非採用的立場有被寫下來而不是留給下一個人自己猜。
   */
  it('明文聲明不採用 TEST overlay，且不重用 0040 前綴', () => {
    expect(MIGRATION).toContain('不採用 TEST 的歷史 #41 overlay');
    expect(MIGRATION).toContain('本檔不重用 `0040` 前綴');
    expect(readdirSync(resolve(__dirname, '../../supabase/migrations')))
      .not.toContain('0040_issue_41_group_formation_lifecycle.sql');
  });
});
