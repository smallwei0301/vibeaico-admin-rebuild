/**
 * 旅客風險政策 — RLS、值域與稽核不可篡改性的直接 DB 驗證（issue #44 第一步）
 * -----------------------------------------------------------------------------
 * 對應 `supabase/migrations/0105_issue_44_traveler_risk_policies.sql`。
 * 本輪邊界是 source-only 持久化層，沒有 `/api` 端點，因此本檔比照
 * `tests/integration/db/rls.test.ts` 的樣式，直接用 supabase-js 對 TEST 資料庫
 * 查——驗的是 Postgres RLS／check constraint／複合 FK 本身，不是 HTTP 層。
 *
 * ⚠️ 交付狀態：本檔已依 12 分冊撰寫，但**未對 canonical TEST 執行**——依
 * `docs/AGENT-EXECUTION.md` §3.1，TEST lane 的排程是 TRIAGE 職責，本輪也沒有
 * 可用的本機隔離 Supabase（無 Docker daemon）。紅／綠狀態待下一輪在正確
 * TEST lane 下驗證，見 PR checkpoint 說明。
 *
 * 涵蓋 Issue #44 驗收清單：
 *   - 「A 店看不到 B 店標籤、備註、政策或統計」
 *   - 「所有政策套用必須有原因、操作者與時間紀錄」
 *   - 「政策變更有 audit；歷史訂單不因顧客停用而斷鏈」（append-only：不可
 *     UPDATE/DELETE，只能再指派新一列）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import {
  assignTravelerRiskPolicy,
  getCurrentTravelerRiskPolicy,
  listTravelerRiskPolicyHistory,
} from '@/server/traveler-risk-policy';

const url = () => process.env.TEST_SUPABASE_URL!;
const anonKey = () => process.env.TEST_SUPABASE_ANON_KEY!;

let admin: SupabaseClient;
let asOwnerA: SupabaseClient;
let asOwnerB: SupabaseClient;
let asStaffA: SupabaseClient;
let ownerAUid: string;
let ownerBUid: string;

/** 本檔造出的政策列一律用 SHOP_A.customerA2 掛，afterAll 以 service role 清掉。 */
const TARGET_CUSTOMER = SHOP_A.customerA1;

beforeAll(async () => {
  expect(url()).toBeTruthy();
  expect(anonKey()).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  admin = createClient(url(), process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  asOwnerA = createClient(url(), anonKey(), { auth: { persistSession: false } });
  const { data: signInA, error: errA } = await asOwnerA.auth.signInWithPassword({
    email: SHOP_A.owner.email, password: SHOP_A.owner.password,
  });
  expect(errA).toBeNull();
  ownerAUid = signInA!.user!.id;

  asOwnerB = createClient(url(), anonKey(), { auth: { persistSession: false } });
  const { data: signInB, error: errB } = await asOwnerB.auth.signInWithPassword({
    email: SHOP_B.owner.email, password: SHOP_B.owner.password,
  });
  expect(errB).toBeNull();
  ownerBUid = signInB!.user!.id;

  asStaffA = createClient(url(), anonKey(), { auth: { persistSession: false } });
  const { error: errStaff } = await asStaffA.auth.signInWithPassword({
    email: STAFF_A2.email, password: STAFF_A2.password,
  });
  expect(errStaff).toBeNull();
});

afterAll(async () => {
  await admin.from('traveler_risk_policies').delete().eq('tenant_id', SHOP_A.id);
});

describe('RLS：跨租戶隔離', () => {
  it('A owner 指派一筆政策後，B owner 完全查不到（連自己店過濾都不用做）', async () => {
    const created = await assignTravelerRiskPolicy(asOwnerA, SHOP_A.id, ownerAUid, {
      customerId: TARGET_CUSTOMER, policy: 'FORCE_DEPOSIT',
      deposit: { mode: 'DEPOSIT_PERCENT', value: 50 },
      reason: '常臨時改時間', actorLabel: 'Wayne',
    });
    expect(created.tenantId).toBe(SHOP_A.id);

    const { data, error } = await asOwnerB.from('traveler_risk_policies').select('*');
    expect(error).toBeNull();
    expect(data!.some((r) => r.id === created.id)).toBe(false);

    const currentForB = await getCurrentTravelerRiskPolicy(asOwnerB, SHOP_A.id, TARGET_CUSTOMER);
    expect(currentForB).toBeNull(); // RLS 濾成 0 列，不是「查到但沒有值」
  });

  it('A owner 想把 tenant_id 填自己店、customer_id 填 B 店顧客 → 複合 FK 拒絕（23503），不是安靜寫入垃圾資料', async () => {
    await expect(assignTravelerRiskPolicy(asOwnerA, SHOP_A.id, ownerAUid, {
      customerId: SHOP_B.customerB1, policy: 'DEFAULT',
      reason: '跨租戶顧客 id 測試', actorLabel: 'Wayne',
    })).rejects.toMatchObject({ code: '23503' });
  });

  it('A owner 想寫入 tenant_id=B 店 → RLS 拒絕 insert（is_tenant_member(B)=false）', async () => {
    await expect(assignTravelerRiskPolicy(asOwnerA, SHOP_B.id, ownerAUid, {
      customerId: SHOP_B.customerB1, policy: 'DEFAULT',
      reason: '跨租戶 tenant_id 測試', actorLabel: 'Wayne',
    })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('角色門檻：MANAGER 以上才能套用政策', () => {
  it('STAFF 讀得到，但寫不了（42501，不是「安靜失敗回 0 筆」）', async () => {
    const { data, error } = await asStaffA.from('traveler_risk_policies').select('*').eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true); // 至少讀得動，不是整張表被擋

    await expect(assignTravelerRiskPolicy(asStaffA, SHOP_A.id, ownerAUid, {
      customerId: TARGET_CUSTOMER, policy: 'BLOCK_SELF_SERVICE',
      reason: 'STAFF 嘗試套用政策', actorLabel: '員工測試',
    })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('操作者身分不可冒名', () => {
  it('A owner 嘗試把 actor_user_id 寫成別人（B owner）→ RLS with check 拒絕', async () => {
    const { error } = await asOwnerA.from('traveler_risk_policies').insert({
      tenant_id: SHOP_A.id, customer_id: TARGET_CUSTOMER, policy: 'DEFAULT',
      reason: '冒名操作者測試', actor_user_id: ownerBUid, actor_label: '冒名',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

describe('值域：資料庫是最後一道防線（不只靠應用層 zod）', () => {
  it('policy 是未知值（繞過應用層直打 PostgREST）→ check constraint 拒絕（23514）', async () => {
    const { error } = await asOwnerA.from('traveler_risk_policies').insert({
      tenant_id: SHOP_A.id, customer_id: TARGET_CUSTOMER, policy: 'FORCE_NO_DEPOSIT',
      reason: '值域測試：不存在的政策值', actor_user_id: ownerAUid, actor_label: 'Wayne',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });

  it('FORCE_DEPOSIT 但 deposit_mode=FULL（2026-09-11 Owner Decision 明文禁止的等價豁免）→ 23514', async () => {
    const { error } = await asOwnerA.from('traveler_risk_policies').insert({
      tenant_id: SHOP_A.id, customer_id: TARGET_CUSTOMER, policy: 'FORCE_DEPOSIT',
      deposit_mode: 'FULL', deposit_value: 0,
      reason: '值域測試：FULL 等同免訂金', actor_user_id: ownerAUid, actor_label: 'Wayne',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });

  it('DEFAULT 卻帶 deposit_mode → 23514', async () => {
    const { error } = await asOwnerA.from('traveler_risk_policies').insert({
      tenant_id: SHOP_A.id, customer_id: TARGET_CUSTOMER, policy: 'DEFAULT',
      deposit_mode: 'DEPOSIT_FIXED', deposit_value: 100,
      reason: '值域測試：DEFAULT 不該帶 deposit', actor_user_id: ownerAUid, actor_label: 'Wayne',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });

  it('reason 少於 4 字（繞過應用層）→ 23514', async () => {
    const { error } = await asOwnerA.from('traveler_risk_policies').insert({
      tenant_id: SHOP_A.id, customer_id: TARGET_CUSTOMER, policy: 'DEFAULT',
      reason: '嗯', actor_user_id: ownerAUid, actor_label: 'Wayne',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });
});

describe('append-only：不可篡改的稽核帳本', () => {
  // 這條原本斷言「RLS 沒有對應 policy → 影響 0 列、不報錯」。在 local isolated
  // 從 0001 建起的真實資料庫上實跑後，拿到的是 42501（insufficient_privilege），
  // 不是安靜的 0 列——因為 0105 依 PB-028 三段式處理，連 authenticated 的
  // UPDATE/DELETE **授權本身**都撤掉了，缺 GRANT 會在 RLS 被諮詢之前就擋下。
  //
  // 也就是說實際行為比原本的預期更強：篡改者拿到硬錯誤，而不是以為「我改了但
  // 沒生效」。修正的是斷言，不是 migration。
  //
  // 刻意釘住具體錯誤碼而不是只寫 `toBeTruthy()`：日後若有人把 UPDATE 權限
  // 補回給 authenticated，行為會退化成「只靠 RLS 擋、回 0 列且 error 為 null」，
  // 那時這條會轉紅。寫成 truthy 就抓不到那種退化。
  it('UPDATE/DELETE 被授權層直接擋下（42501），不是安靜地影響 0 列', async () => {
    const created = await assignTravelerRiskPolicy(asOwnerA, SHOP_A.id, ownerAUid, {
      customerId: TARGET_CUSTOMER, policy: 'REQUEST_ONLY',
      reason: '不可篡改測試基準列', actorLabel: 'Wayne',
    });

    const { error: updateErr } = await asOwnerA
      .from('traveler_risk_policies').update({ reason: '被竄改' }).eq('id', created.id).select('*');
    expect(updateErr?.code).toBe('42501');

    const { error: deleteErr } = await asOwnerA
      .from('traveler_risk_policies').delete().eq('id', created.id).select('*');
    expect(deleteErr?.code).toBe('42501');

    // service role 直查證明原始列真的還在、內容未變（不是巧合地 update 影響了別列）
    const { data: row } = await admin.from('traveler_risk_policies').select('reason').eq('id', created.id).single();
    expect(row!.reason).toBe('不可篡改測試基準列');
  });

  it('「解除政策」= 再指派一筆 DEFAULT；歷史仍完整保留兩筆，不覆寫前一筆', async () => {
    const first = await assignTravelerRiskPolicy(asOwnerA, SHOP_A.id, ownerAUid, {
      customerId: TARGET_CUSTOMER, policy: 'BLOCK_SELF_SERVICE',
      reason: '先設一個限制', actorLabel: 'Wayne',
    });
    const second = await assignTravelerRiskPolicy(asOwnerA, SHOP_A.id, ownerAUid, {
      customerId: TARGET_CUSTOMER, policy: 'DEFAULT',
      reason: '確認正常後解除限制', actorLabel: 'Wayne',
    });

    const current = await getCurrentTravelerRiskPolicy(asOwnerA, SHOP_A.id, TARGET_CUSTOMER);
    expect(current!.id).toBe(second.id);
    expect(current!.policy).toBe('DEFAULT');

    const history = await listTravelerRiskPolicyHistory(asOwnerA, SHOP_A.id, TARGET_CUSTOMER);
    const ids = history.map((h) => h.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(history[0].id).toBe(second.id); // 最新在前
  });
});
