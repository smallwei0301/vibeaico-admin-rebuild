/**
 * 成團狀態模型 — 資料庫層不變量的直接驗證（issue #41 第一片）
 * -----------------------------------------------------------------------------
 * 對應 `supabase/migrations/0107_issue_41_formation_state_model.sql`，依
 * `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §1–§3。
 *
 * 這一片的邊界是狀態模型本身，還沒有 §6 的自動推進 transaction，也沒有對應的
 * `/api` 端點。因此比照 `tests/integration/db/rls.test.ts` 與
 * `traveler-risk-policy.44.test.ts` 的樣式，直接以 service role 對資料庫下手——
 * 驗的是 **Postgres 的 CHECK 與型別本身**，不是 HTTP 層。
 *
 * 用 service role 是刻意的：本檔要證明的是「即使繞過應用層，資料庫仍然擋得住」。
 * 若改用受 RLS 限制的身分，擋下來的可能是 RLS 而不是我要測的那條 CHECK，那就
 * 證明不了任何事（同一類混淆已記在 PB-028）。
 *
 * 每個案例都自己建立並清掉一個團次，不依賴 seed 的既有列，也不留殘留。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TRIP_A } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;

let admin: SupabaseClient;
const created: string[] = [];

/** 專屬本檔的團次 id 前綴，afterAll 一律清掉，避免污染其他測試。 */
const DEP = (n: number) => `41000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

async function insertDeparture(id: string, extra: Record<string, unknown> = {}) {
  created.push(id);
  return admin.from('trip_departures').insert({
    id,
    tenant_id: TRIP_A.tenantId,
    trip_id: TRIP_A.id,
    plan_id: TRIP_A.planA1,
    departs_on: '2026-12-01',
    start_time: '09:00:00',
    capacity: 8,
    seats_booked: 0,
    status: 'OPEN',
    note: '',
    ...extra,
  });
}

beforeAll(async () => {
  expect(url()).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(url(), process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

afterAll(async () => {
  if (!admin || !created.length) return;
  const { error } = await admin.from('trip_departures').delete().in('id', created);
  if (error) throw new Error(`清理本檔建立的團次失敗：${error.message}`);
});

describe('#41 §3：成團狀態與販售狀態是兩條獨立的軸', () => {
  it('預設是 COLLECTING，門檻預設 1', async () => {
    const id = DEP(1);
    const { error } = await insertDeparture(id);
    expect(error).toBeNull();
    const { data } = await admin.from('trip_departures')
      .select('status, formation_status, min_to_depart_snapshot').eq('id', id).single();
    expect(data!.status).toBe('OPEN');
    expect(data!.formation_status).toBe('COLLECTING');
    expect(data!.min_to_depart_snapshot).toBe(1);
  });

  /* 18 分冊 §3 明列的合法組合；`FORMED` 不得被當成 `CLOSED` 的同義詞。 */
  it.each([
    ['OPEN', 'COLLECTING'],
    ['OPEN', 'FORMED'],
    ['CLOSED', 'FORMED'],
    ['OPEN', 'REVIEW_REQUIRED'],
    ['CANCELLED', 'FAILED'],
  ])('接受合法組合 %s + %s', async (status, formation) => {
    const id = DEP(10 + ['COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED'].indexOf(formation) * 3
      + ['OPEN', 'CLOSED', 'CANCELLED'].indexOf(status));
    const evidence = formation === 'FORMED' || formation === 'AT_RISK'
      ? { formed_at: new Date().toISOString(), formed_by: 'SYSTEM', formed_participants: 4 }
      : {};
    const { error } = await insertDeparture(id, { status, formation_status: formation, ...evidence });
    expect(error).toBeNull();
  });

  it('拒絕不在值域內的成團狀態', async () => {
    const { error } = await insertDeparture(DEP(30), { formation_status: 'SOMETHING_ELSE' });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('22P02');
  });
});

describe('#41 §3：一次性成團證據不可缺、也不可被抹掉', () => {
  it.each([
    ['FORMED', {}],
    ['FORMED', { formed_at: new Date().toISOString() }],
    ['FORMED', { formed_at: new Date().toISOString(), formed_by: 'SYSTEM' }],
    ['AT_RISK', {}],
    ['AT_RISK', { formed_at: new Date().toISOString(), formed_by: 'SYSTEM' }],
  ])('%s 缺少完整證據時被 CHECK 擋下', async (formation, evidence) => {
    const { error } = await insertDeparture(DEP(40), { formation_status: formation, ...evidence });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  /*
   * AT_RISK 是成團之後才可能發生的狀態。若只有 FORMED 被約束，「人數跌破門檻後
   * 把證據抹掉」就會是合法操作——那等於否認曾經對旅客做過的出團承諾。
   */
  it('已成團的團次不得把證據清空再轉 AT_RISK', async () => {
    const id = DEP(41);
    const { error: insertError } = await insertDeparture(id, {
      formation_status: 'FORMED', formed_at: new Date().toISOString(),
      formed_by: 'SYSTEM', formed_participants: 5,
    });
    expect(insertError).toBeNull();

    const { error } = await admin.from('trip_departures').update({
      formation_status: 'AT_RISK', formed_at: null, formed_by: null, formed_participants: null,
    }).eq('id', id);
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it.each([undefined, 'guide_override', 'OTHER', ''])('拒絕不合法的 formed_by %s', async (formedBy) => {
    const { error } = await insertDeparture(DEP(45), {
      formation_status: 'FORMED', formed_at: new Date().toISOString(),
      formed_by: formedBy, formed_participants: 3,
    });
    expect(error).toBeTruthy();
  });

  it('拒絕 formed_participants 為 0 或負數', async () => {
    for (const n of [0, -1]) {
      const { error } = await insertDeparture(DEP(46), {
        formation_status: 'FORMED', formed_at: new Date().toISOString(),
        formed_by: 'SYSTEM', formed_participants: n,
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe('23514');
    }
  });
});

describe('#41 §1–§2：成團門檻與容量、截止天數的值域', () => {
  it('門檻不得超過容量', async () => {
    const { error } = await insertDeparture(DEP(50), { capacity: 4, min_to_depart_snapshot: 5 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('門檻等於容量是合法的（整團包下）', async () => {
    const { error } = await insertDeparture(DEP(51), { capacity: 4, min_to_depart_snapshot: 4 });
    expect(error).toBeNull();
  });

  it('門檻不得小於 1', async () => {
    const { error } = await insertDeparture(DEP(52), { min_to_depart_snapshot: 0 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  /*
   * §1 最重要的一條：min_party 是「單筆訂單最少幾人」，min_to_depart 是「整團
   * 最低成團人數」。兩者必須能同時存在且互不影響。
   */
  it('Plan 的 min_party 與 min_to_depart 是兩個獨立欄位', async () => {
    const { data, error } = await admin.from('trip_plans')
      .select('min_party, max_party, min_to_depart, formation_deadline_days_before, sales_mode, participation_mode')
      .eq('id', TRIP_A.planA1).single();
    expect(error).toBeNull();
    expect(data!.min_party).not.toBeUndefined();
    expect(data!.min_to_depart).not.toBeUndefined();
    expect(data!.formation_deadline_days_before).toBe(7);
    expect(data!.sales_mode).toBe('FIXED_DEPARTURE');
    expect(data!.participation_mode).toBe('SHARED');
  });

  it.each([-1, 91])('Plan 的成團截止天數 %s 超出 0–90 被擋下', async (days) => {
    const { error } = await admin.from('trip_plans')
      .update({ formation_deadline_days_before: days }).eq('id', TRIP_A.planA1);
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  /* §2.1：0 是合法的專業用法（募集到出發日），不得被當成錯誤擋掉。 */
  it('Plan 的成團截止天數可以是 0', async () => {
    const { error } = await admin.from('trip_plans')
      .update({ formation_deadline_days_before: 0 }).eq('id', TRIP_A.planA1);
    expect(error).toBeNull();
    await admin.from('trip_plans')
      .update({ formation_deadline_days_before: 7 }).eq('id', TRIP_A.planA1);
  });

  it.each(['FIXED_DEPARTURE', 'INSTANT', 'REQUEST'])('接受合法的 sales_mode %s', async (mode) => {
    const { error } = await admin.from('trip_plans').update({ sales_mode: mode }).eq('id', TRIP_A.planA1);
    expect(error).toBeNull();
    await admin.from('trip_plans').update({ sales_mode: 'FIXED_DEPARTURE' }).eq('id', TRIP_A.planA1);
  });

  it('拒絕不在值域內的 sales_mode', async () => {
    const { error } = await admin.from('trip_plans')
      .update({ sales_mode: 'WALK_IN' }).eq('id', TRIP_A.planA1);
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });
});
