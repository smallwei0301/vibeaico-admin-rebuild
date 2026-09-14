import { describe, expect, it } from 'vitest';
import {
  TRAVELER_RISK_POLICY_KINDS,
  assignTravelerRiskPolicySchema,
  mapTravelerRiskPolicyRow,
} from '@/server/traveler-risk-policy';

const base = {
  customerId: '11111111-1111-4111-8111-111111111111',
  reason: '常臨時改時間',
  actorLabel: 'Wayne',
};

describe('TRAVELER_RISK_POLICY_KINDS (#44 — 2026-09-11 Owner Decision: 不提供熟客免訂金)', () => {
  it('只有四個值，且不含任何免訂金／豁免等價值', () => {
    expect(TRAVELER_RISK_POLICY_KINDS).toEqual([
      'DEFAULT', 'FORCE_DEPOSIT', 'REQUEST_ONLY', 'BLOCK_SELF_SERVICE',
    ]);
    for (const forbidden of ['FORCE_NO_DEPOSIT', 'WAIVE_DEPOSIT', 'TRUSTED_NO_DEPOSIT']) {
      expect(TRAVELER_RISK_POLICY_KINDS).not.toContain(forbidden);
    }
  });
});

describe('assignTravelerRiskPolicySchema — 值域與必填欄位', () => {
  it('DEFAULT/REQUEST_ONLY/BLOCK_SELF_SERVICE 不需要 deposit', () => {
    for (const policy of ['DEFAULT', 'REQUEST_ONLY', 'BLOCK_SELF_SERVICE'] as const) {
      const result = assignTravelerRiskPolicySchema.safeParse({ ...base, policy });
      expect(result.success).toBe(true);
    }
  });

  it('FORCE_DEPOSIT 缺 deposit → 拒絕', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({ ...base, policy: 'FORCE_DEPOSIT' });
    expect(result.success).toBe(false);
  });

  it('DEFAULT 卻帶 deposit → 拒絕（值域不允許非 FORCE_DEPOSIT 帶 deposit）', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({
      ...base, policy: 'DEFAULT', deposit: { mode: 'DEPOSIT_FIXED', value: 100 },
    });
    expect(result.success).toBe(false);
  });

  it('FORCE_DEPOSIT + DEPOSIT_FIXED 合法值 → 接受', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({
      ...base, policy: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_FIXED', value: 500 },
    });
    expect(result.success).toBe(true);
  });

  it('FORCE_DEPOSIT + DEPOSIT_FIXED value<=0 → 拒絕（對齊 resolvePaymentPolicy DEPOSIT_VALUE_INVALID）', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({
      ...base, policy: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_FIXED', value: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('FORCE_DEPOSIT + DEPOSIT_PERCENT 1~100 合法 → 接受', () => {
    for (const value of [1, 50, 100]) {
      const result = assignTravelerRiskPolicySchema.safeParse({
        ...base, policy: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_PERCENT', value },
      });
      expect(result.success).toBe(true);
    }
  });

  it('FORCE_DEPOSIT + DEPOSIT_PERCENT 超出 1~100 → 拒絕（對齊 DEPOSIT_PERCENT_OUT_OF_RANGE）', () => {
    for (const value of [0, 101, -1]) {
      const result = assignTravelerRiskPolicySchema.safeParse({
        ...base, policy: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_PERCENT', value },
      });
      expect(result.success).toBe(false);
    }
  });

  it('reason 少於 4 字 → 拒絕（避免「無字理由」的政策套用）', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({ ...base, policy: 'DEFAULT', reason: '嗯' });
    expect(result.success).toBe(false);
  });

  it('actorLabel 空白字串 → 拒絕', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({ ...base, policy: 'DEFAULT', actorLabel: '   ' });
    expect(result.success).toBe(false);
  });

  it('未知 policy 值（例如熟客免訂金等價值）→ 拒絕', () => {
    const result = assignTravelerRiskPolicySchema.safeParse({ ...base, policy: 'FORCE_NO_DEPOSIT' });
    expect(result.success).toBe(false);
  });
});

describe('mapTravelerRiskPolicyRow', () => {
  it('deposit_mode/deposit_value 皆有值時組成 deposit 物件，數值型別正確', () => {
    const mapped = mapTravelerRiskPolicyRow({
      id: 'p1', tenant_id: 't1', customer_id: 'c1', policy: 'FORCE_DEPOSIT',
      deposit_mode: 'DEPOSIT_PERCENT', deposit_value: '30', // PostgREST numeric 常以字串回傳
      reason: '需先付訂金', actor_user_id: 'u1', actor_label: 'Wayne',
      created_at: '2026-08-28T00:00:00.000Z',
    });
    expect(mapped.deposit).toEqual({ mode: 'DEPOSIT_PERCENT', value: 30 });
  });

  // 2026-09-11 Owner Decision（不提供熟客免訂金）明文要求：第一版不得有
  // FORCE_NO_DEPOSIT 或任何「等價能力」。TripPlan.depositMode 有 NONE／FULL
  // 兩個值，若它們能從這裡進來，FORCE_DEPOSIT 就變成「強制不用訂金」或
  // 「強制全額」——前者正是被禁止的等價豁免。
  //
  // 這兩條由 Final Risk 覆核（claude-fable-5-1）查出缺口而補：它把 zod 的
  // FORCE_DEPOSIT_MODES 放寬到含 FULL／NONE，22 條測試仍全綠（突變存活）。
  // 當時 DB 的 CHECK 與 kernel 的 resolveTravelerBookingPolicy() 都仍會拒絕，
  // 所以不是安全漏洞；但 API 層的守門沒有任何回歸測試，日後放寬只會在
  // 資料庫層才被發現。這兩條把守門釘在最靠近入口的地方。
  it.each(['FULL', 'NONE'])(
    'FORCE_DEPOSIT 的 deposit.mode 不接受 %s（2026-09-11 裁示禁止的等價豁免）',
    (mode) => {
      const result = assignTravelerRiskPolicySchema.safeParse({
        customerId: '00000000-0000-4000-8000-000000000001',
        policy: 'FORCE_DEPOSIT',
        deposit: { mode, value: 1 },
        reason: '測試等價豁免必須被擋下',
        actorLabel: 'Wayne',
      });
      expect(result.success).toBe(false);
    },
  );

  it('deposit_mode 為 null 時 deposit 回 null', () => {
    const mapped = mapTravelerRiskPolicyRow({
      id: 'p2', tenant_id: 't1', customer_id: 'c1', policy: 'DEFAULT',
      deposit_mode: null, deposit_value: null,
      reason: '恢復一般政策', actor_user_id: 'u1', actor_label: 'Wayne',
      created_at: '2026-08-29T00:00:00.000Z',
    });
    expect(mapped.deposit).toBeNull();
  });
});
