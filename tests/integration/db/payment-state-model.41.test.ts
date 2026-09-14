/**
 * 付款狀態模型 — 資料庫層不變量的直接驗證（issue #41 第二片）
 * -----------------------------------------------------------------------------
 * 對應 `supabase/migrations/0108_issue_41_payment_state_model.sql`，依
 * `docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §4。
 *
 * 比照 `formation-state-model.41.test.ts` 的樣式，直接以 service role 對資料庫
 * 下手——驗的是 **Postgres 的 CHECK 與型別本身**，不是 HTTP 層，也不是 §5–§6 的
 * 自動推進 transaction（那些還沒實作）。
 *
 * `tour_orders` 有 `unique (tenant_id, order_no)`：每筆插入都給不同的 order_no，
 * 否則第二筆之後會撞 23505，而「預期失敗」的案例還會因此看似通過（那是最糟的一種
 * 綠燈——測試通過了，但通過的理由不是我以為的那個，見 formation-state-model 的同一
 * 個教訓）。
 *
 * 每個案例都自己建立並清掉一筆訂單，不依賴 seed 的既有列，也不留殘留。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TRIP_A } from '../../fixtures';

const url = () => process.env.TEST_SUPABASE_URL!;

let admin: SupabaseClient;
const created: string[] = [];
let seq = 0;

beforeAll(async () => {
  expect(url()).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(url(), process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

afterAll(async () => {
  if (!admin || !created.length) return;
  const { error } = await admin.from('tour_orders').delete().in('id', created);
  if (error) throw new Error(`清理本檔建立的訂單失敗：${error.message}`);
});

/**
 * `tour_orders` 的必要欄位取自 0087：tenant_id／order_no／trip_id／plan_id／
 * departure_id／party_size／unit_price／total_amount／source。`order_no` 每次
 * 遞增，避免撞 `unique (tenant_id, order_no)`。
 */
async function insertOrder(extra: Record<string, unknown> = {}) {
  seq += 1;
  const id = `41100000-0000-4000-9000-${String(seq).padStart(12, '0')}`;
  created.push(id);
  const row = {
    id,
    tenant_id: TRIP_A.tenantId,
    order_no: `PAY41-${String(seq).padStart(4, '0')}`,
    trip_id: TRIP_A.id,
    plan_id: TRIP_A.planA1,
    departure_id: TRIP_A.departure1,
    party_size: 2,
    unit_price: 1000,
    total_amount: 2000,
    deposit_amount: 0,
    contact: {},
    source: 'MANUAL',
    note: '',
    ...extra,
  };
  const result = await admin.from('tour_orders').insert(row).select('id').single();
  return { id, ...result };
}

describe('#41 §4：付款狀態值域補齊 PARTIAL／REFUND_PENDING', () => {
  it.each(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'])(
    '接受合法的付款狀態 %s',
    async (status) => {
      const extra: Record<string, unknown> = { payment_status: status };
      if (status === 'PARTIAL') extra.paid_amount = 500;
      if (status === 'PAID') extra.paid_amount = 2000;
      if (status === 'REFUND_PENDING') extra.paid_amount = 2000;
      // tour_orders_refunded_paid_amount_ck（#41 0108 M1）要求 REFUNDED 同時
      // paid_amount > 0 與 refunded_amount > 0——一筆從未收款的訂單不能自稱
      // 「已退款」。
      if (status === 'REFUNDED') {
        extra.paid_amount = 2000;
        extra.refunded_amount = 2000;
      }
      const { error } = await insertOrder(extra);
      expect(error).toBeNull();
    },
  );

  it('拒絕不在值域內的付款狀態', async () => {
    const { error } = await insertOrder({ payment_status: 'SOMETHING_ELSE' });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('22P02');
  });
});

describe('#41 §4：PARTIAL 必須誠實——已收一部分、還沒收齊', () => {
  it('paid_amount = 0 時不得標成 PARTIAL', async () => {
    const { error } = await insertOrder({ payment_status: 'PARTIAL', paid_amount: 0 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount = total_amount 時不得標成 PARTIAL（應該是 PAID）', async () => {
    const { error } = await insertOrder({ payment_status: 'PARTIAL', paid_amount: 2000 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount 介於 0 與 total_amount 之間時合法', async () => {
    const { error } = await insertOrder({ payment_status: 'PARTIAL', paid_amount: 800 });
    expect(error).toBeNull();
  });
});

describe('#41 §4：REFUND_PENDING 必須誠實——代表確實收過錢，正在退款中', () => {
  it('paid_amount = 0 時不得標成 REFUND_PENDING', async () => {
    const { error } = await insertOrder({ payment_status: 'REFUND_PENDING', paid_amount: 0 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount > 0 時合法', async () => {
    const { error } = await insertOrder({ payment_status: 'REFUND_PENDING', paid_amount: 2000 });
    expect(error).toBeNull();
  });
});

/*
 * Final Risk（claude-fable-5-1，2026-09-14）M1：REFUNDED 之前沒有誠實 CHECK，
 * `payment_status='REFUNDED', paid_amount=0, refunded_amount=0`（一筆從未收款
 * 的訂單自稱已退款）曾被接受。
 */
describe('#41 §4 M1：REFUNDED 必須誠實——確實收過錢、也確實退了款', () => {
  it('paid_amount = 0 且 refunded_amount = 0 時不得標成 REFUNDED', async () => {
    const { error } = await insertOrder({ payment_status: 'REFUNDED', paid_amount: 0, refunded_amount: 0 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount > 0 但 refunded_amount = 0 時仍不得標成 REFUNDED（只收錢沒退錢）', async () => {
    const { error } = await insertOrder({ payment_status: 'REFUNDED', paid_amount: 2000, refunded_amount: 0 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount > 0 且 refunded_amount > 0 時合法', async () => {
    const { error } = await insertOrder({ payment_status: 'REFUNDED', paid_amount: 2000, refunded_amount: 2000 });
    expect(error).toBeNull();
  });
});

/*
 * Final Risk M2：UNPAID 之前只有值域限制，`payment_status='UNPAID',
 * paid_amount=500` 曾被接受——語意上那筆訂單其實是 PARTIAL 或 PAID，卻在畫面
 * 上顯示成「未付款」。
 */
describe('#41 §4 M2：UNPAID 必須誠實——沒收過錢才能標成 UNPAID', () => {
  it('paid_amount > 0 時不得標成 UNPAID', async () => {
    const { error } = await insertOrder({ payment_status: 'UNPAID', paid_amount: 500 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('paid_amount = 0 時合法', async () => {
    const { error } = await insertOrder({ payment_status: 'UNPAID', paid_amount: 0 });
    expect(error).toBeNull();
  });
});

describe('#41 §4：upfront_required_amount 的值域', () => {
  it('不得為負數', async () => {
    const { error } = await insertOrder({ upfront_required_amount: -1 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('不得超過 total_amount', async () => {
    const { error } = await insertOrder({ upfront_required_amount: 2001 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('等於 total_amount 是合法的（全額頭期款）', async () => {
    const { error } = await insertOrder({ upfront_required_amount: 2000 });
    expect(error).toBeNull();
  });

  it('0 是合法的（NONE 收款政策，不要求頭期款）', async () => {
    const { error } = await insertOrder({ upfront_required_amount: 0 });
    expect(error).toBeNull();
  });
});

describe('#41 §4：refunded_amount 不得為負、不得超過實收（§9.3 平台固定底線）', () => {
  it('不得為負數', async () => {
    const { error } = await insertOrder({ refunded_amount: -1 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('不得超過 paid_amount', async () => {
    const { error } = await insertOrder({ paid_amount: 500, refunded_amount: 501 });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });

  it('等於 paid_amount 是合法的（全額退款）', async () => {
    const { error } = await insertOrder({ paid_amount: 500, refunded_amount: 500, payment_status: 'REFUND_PENDING' });
    expect(error).toBeNull();
  });

  it('已成交訂單先付款、之後才登記部分退款是合法的', async () => {
    const id0 = (await insertOrder({ paid_amount: 2000, payment_status: 'PAID' })).id;
    const { error } = await admin.from('tour_orders')
      .update({ payment_status: 'REFUND_PENDING', refunded_amount: 300 })
      .eq('id', id0);
    expect(error).toBeNull();
  });
});

describe('#41 §4：deposit_mode_snapshot 與 0066 的 trip_plans.deposit_mode 同一值域', () => {
  it.each(['NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'])('接受合法值 %s', async (mode) => {
    const { error } = await insertOrder({ deposit_mode_snapshot: mode });
    expect(error).toBeNull();
  });

  it('null 是合法的（尚未補這個欄位的舊資料）', async () => {
    const { error } = await insertOrder({ deposit_mode_snapshot: null });
    expect(error).toBeNull();
  });

  it('拒絕不在值域內的值', async () => {
    const { error } = await insertOrder({ deposit_mode_snapshot: 'WALK_IN' });
    expect(error).toBeTruthy();
    expect(error!.code).toBe('23514');
  });
});

describe('#41 §4：新欄位的預設值誠實地代表「還沒有任何金流資訊」', () => {
  it('未指定時 upfront_required_amount／refunded_amount 預設為 0，deposit_mode_snapshot 預設為 null', async () => {
    const { id, error } = await insertOrder();
    expect(error).toBeNull();
    const { data } = await admin.from('tour_orders')
      .select('upfront_required_amount, refunded_amount, deposit_mode_snapshot, paid_amount')
      .eq('id', id).single();
    expect(data!.upfront_required_amount).toBe(0);
    expect(data!.refunded_amount).toBe(0);
    expect(data!.deposit_mode_snapshot).toBeNull();
    // 0087 既有欄位不受本檔影響
    expect(data!.paid_amount).toBe(0);
  });
});
