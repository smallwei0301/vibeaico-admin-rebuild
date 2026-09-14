import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapTourOrder } from '@/server/mappers';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0108_issue_41_payment_state_model.sql'),
  'utf8',
);

const derived = {
  tripTitle: '標準團',
  planName: '標準方案',
  departsOn: '2026-10-01',
  startTime: '09:00',
  paymentMethodLabel: '匯款',
};

const orderRow = (extra: Record<string, unknown> = {}) => ({
  id: 'order-1',
  order_no: 'A0001',
  trip_id: 'trip-1',
  party_size: 2,
  unit_price: 1000,
  total_amount: 2000,
  deposit_amount: 0,
  contact: { name: '王小明', phone: '0900000000' },
  status: 'PENDING',
  payment_status: 'UNPAID',
  payment_ref: '',
  source: 'MANUAL',
  hold_expires_at: null,
  note: '',
  created_at: '2026-09-14T00:00:00Z',
  ...extra,
});

/*
 * 18 分冊 §4／§9.3 的平台固定底線：「payment/refund state 必須誠實」。窄化方向
 * 一律取「最不會讓 UI 誤宣稱已收到錢／已退款」的那個值——查不到或看不懂的輸入，
 * 寧可窄成「沒有頭期款要求」「沒有退款」「不知道收款政策」，也不能猜出一個會讓
 * UI 顯示已收錢/已退款的具體數字或狀態。
 */
describe('#41 §4 mapTourOrder：新欄位的窄化必須 fail-closed', () => {
  describe('paymentStatus 也必須收斂，不得直通', () => {
    /*
     * 「canonical 端是 enum，DB 已保證值域」不足以支撐直通：2026-09-14 實查
     * shared TEST，trip_departures.formation_status 就是歷史 overlay 殘留的 text。
     * 同一個工作的另一半欄位能以 text 存在於某個環境，payment_status 沒有豁免。
     */
    it.each([undefined, null, '', 'partial', 'UNKNOWN', 'FORMED', 7, {}])(
      '未知值 %p 收斂成 UNPAID，不得讓 UI 誤宣稱已收款',
      (raw) => {
        expect(mapTourOrder(orderRow({ payment_status: raw }), derived).paymentStatus).toBe('UNPAID');
      },
    );

    it.each(['UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'])(
      '合法值 %s 原樣保留',
      (raw) => {
        expect(mapTourOrder(orderRow({ payment_status: raw }), derived).paymentStatus).toBe(raw);
      },
    );
  });

  describe('upfrontRequiredAmount：非有限數字一律收斂成 0', () => {
    it.each([undefined, null, '', 'abc', 'NaN', {}, []])(
      '把 %s 收斂成 0',
      (raw) => {
        expect(mapTourOrder(orderRow({ upfront_required_amount: raw }), derived).upfrontRequiredAmount).toBe(0);
      },
    );

    it('保留合法的數字', () => {
      expect(mapTourOrder(orderRow({ upfront_required_amount: 500 }), derived).upfrontRequiredAmount).toBe(500);
    });

    it('字串數字也視為合法（DB 驅動可能回字串）', () => {
      expect(mapTourOrder(orderRow({ upfront_required_amount: '500' }), derived).upfrontRequiredAmount).toBe(500);
    });
  });

  describe('refundedAmount：非有限數字一律收斂成 0', () => {
    it.each([undefined, null, '', 'abc', 'NaN', {}, []])(
      '把 %s 收斂成 0',
      (raw) => {
        expect(mapTourOrder(orderRow({ refunded_amount: raw }), derived).refundedAmount).toBe(0);
      },
    );

    it('保留合法的數字', () => {
      expect(mapTourOrder(orderRow({ refunded_amount: 300 }), derived).refundedAmount).toBe(300);
    });
  });

  describe('depositModeSnapshot：不在值域內一律收斂成 null', () => {
    it.each(['NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'])('保留合法值 %s', (raw) => {
      expect(mapTourOrder(orderRow({ deposit_mode_snapshot: raw }), derived).depositModeSnapshot).toBe(raw);
    });

    it.each([undefined, null, '', 'none', 'Full', 'OTHER', 7, {}])(
      '把不合法的 %s 收斂成 null',
      (raw) => {
        expect(mapTourOrder(orderRow({ deposit_mode_snapshot: raw }), derived).depositModeSnapshot).toBeNull();
      },
    );
  });
});

/*
 * 這一組不是在測 SQL 執行結果——那要真實資料庫，由 agent-schema-bootstrap 負責。
 * 這裡守的是「migration 文字裡確實寫了這些不變量」，避免它們在後續編輯中被悄悄
 * 拿掉（沿用 0107 單元測試的既有樣式）。
 */
describe('#41 0108 的資料庫層不變量', () => {
  it.each([
    ['頭期款不得超過總額', 'tour_orders_upfront_required_amount_ck'],
    ['退款不得超過實收', 'tour_orders_refunded_amount_ck'],
    ['收款政策 snapshot 值域', 'tour_orders_deposit_mode_snapshot_ck'],
    ['PARTIAL 必須誠實', 'tour_orders_partial_paid_amount_ck'],
    ['REFUND_PENDING 必須誠實', 'tour_orders_refund_pending_paid_amount_ck'],
    // Final Risk（claude-fable-5-1，2026-09-14）M1／M2：REFUNDED／UNPAID 原本
    // 沒有誠實 CHECK，分別接受過「從未收款卻自稱已退款」與「明明收過錢卻標成
    // 未付款」的髒資料。
    ['REFUNDED 必須誠實', 'tour_orders_refunded_paid_amount_ck'],
    ['UNPAID 必須誠實', 'tour_orders_unpaid_amount_ck'],
  ])('保留 %s 的 CHECK', (_label, name) => {
    expect(MIGRATION).toContain(name);
  });

  /*
   * 這兩條 CHECK 必須用 `payment_status::text <> '…'`，不能用
   * `payment_status <> '…'`。PostgreSQL 規定同一交易內以 `alter type … add value`
   * 新增的 enum 值不得在該交易內被使用，而 Supabase CLI 把每支 migration 包在一個
   * 交易裡；本檔上方才剛新增 PARTIAL 與 REFUND_PENDING，在 historical overlay 的
   * 安裝路徑上那是**真的新增**（overlay 的 0026 只建了三個值）。
   *
   * 這個錯誤本機測不出來——沒有 Postgres 可跑——所以把它釘成文字斷言，否則下次
   * 有人「順手」把 ::text 拿掉，只會在 CI 的 local-isolated 上炸。
   */
  it.each([
    'tour_orders_partial_paid_amount_ck',
    'tour_orders_refund_pending_paid_amount_ck',
    'tour_orders_refunded_paid_amount_ck',
    'tour_orders_unpaid_amount_ck',
  ])('%s 以 ::text 比對，避免同交易內使用剛新增的 enum 值', (name) => {
    const block = MIGRATION.slice(MIGRATION.indexOf(`add constraint ${name}`));
    const check = block.slice(0, block.indexOf('end if;'));
    expect(check).toContain('payment_status::text');
    expect(check).not.toMatch(/payment_status\s*<>/);
  });

  it('付款狀態 enum 補齊 PARTIAL 與 REFUND_PENDING，且五個值同時聲明', () => {
    expect(MIGRATION).toMatch(/'UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED'/);
    expect(MIGRATION).toContain("add value if not exists ''PARTIAL''");
    expect(MIGRATION).toContain("add value if not exists ''REFUND_PENDING''");
  });

  it('不得移除或改寫既有的 paid_amount', () => {
    expect(MIGRATION).not.toMatch(/drop column[^\n]*paid_amount/i);
    expect(MIGRATION).not.toMatch(/rename column[^\n]*paid_amount/i);
    // migration 自己也有一條後置斷言守這件事
    expect(MIGRATION).toContain('tour_orders.paid_amount 不見了');
  });

  it('deposit_mode_snapshot 的值域與 0066 的 trip_plans.deposit_mode 相同', () => {
    expect(MIGRATION).toContain("'NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL'");
  });

  it('不再保留無對應環境的 historical alias skip 名字（死碼，Final Risk 2026-09-14）', () => {
    // 只有說明性的散文（解釋「這兩個名字為什麼被移除」）可以提到這兩個字串；
    // 不能再有 `conname = '…_bounds'` 這種實際被拿來查詢／跳過建立約束的用法。
    expect(MIGRATION).not.toMatch(/conname\s*=\s*'tour_orders_upfront_amount_bounds'/);
    expect(MIGRATION).not.toMatch(/conname\s*=\s*'tour_orders_refunded_amount_bounds'/);
  });

  it('post-assertion 第 2 步同時比對數字欄位的 nullability（I1，Final Risk 2026-09-14）', () => {
    expect(MIGRATION).toContain('attnotnull');
  });

  it('post-assertion 用 regtype 而非 format_type() 做型別比對', () => {
    expect(MIGRATION).toContain('::regtype');
    expect(MIGRATION).not.toMatch(/atttypid\s*=\s*format_type/);
  });

  /*
   * PB-043：M1（REFUNDED）的既有資料前置 guard 曾經缺席——`refunded_amount` 是
   * 本檔新增的欄位，既有 REFUNDED 列的預設值必然是 0，`add constraint
   * tour_orders_refunded_paid_amount_ck` 會對既有資料驗證而以 23514 中止，且
   * 錯誤訊息對人沒有幫助。M2（UNPAID）一直都有等價的前置 guard；這裡鎖住兩者
   * 對稱，避免未來編輯拿掉其中一個卻留著另一個。
   */
  describe('M1／M2 既有資料前置 guard 必須對稱存在（PB-043）', () => {
    it('REFUNDED 有前置 guard：查詢既有違規列並 raise exception，不得憑空消失', () => {
      const idx = MIGRATION.indexOf("payment_status::text = 'REFUNDED'");
      expect(idx).toBeGreaterThan(-1);
      const block = MIGRATION.slice(Math.max(0, idx - 400), idx + 800);
      expect(block).toContain('raise exception');
      expect(block).toContain('bad_rows');
    });

    it('UNPAID 有前置 guard：查詢既有違規列並 raise exception', () => {
      const idx = MIGRATION.indexOf("payment_status::text = 'UNPAID' and paid_amount <> 0");
      expect(idx).toBeGreaterThan(-1);
      const block = MIGRATION.slice(Math.max(0, idx - 400), idx + 400);
      expect(block).toContain('raise exception');
      expect(block).toContain('bad_rows');
    });

    it('M1 guard 出現在 refunded_amount 欄位新增之後、REFUNDED 的 add constraint 之前', () => {
      const columnIdx = MIGRATION.indexOf('add column if not exists refunded_amount');
      const guardIdx = MIGRATION.indexOf("payment_status::text = 'REFUNDED'\n     and not (paid_amount > 0 and refunded_amount > 0)");
      const constraintIdx = MIGRATION.indexOf('add constraint tour_orders_refunded_paid_amount_ck');
      expect(columnIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(constraintIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(columnIdx);
      expect(constraintIdx).toBeGreaterThan(guardIdx);
    });

    it('M1 guard 不得替既有列猜退款金額（不得出現 update ... set refunded_amount）', () => {
      const idx = MIGRATION.indexOf("payment_status::text = 'REFUNDED'\n     and not (paid_amount > 0 and refunded_amount > 0)");
      expect(idx).toBeGreaterThan(-1);
      const block = MIGRATION.slice(Math.max(0, idx - 400), idx + 800);
      expect(block).not.toMatch(/update\s+public\.tour_orders\s+set\s+refunded_amount/i);
    });
  });
});
