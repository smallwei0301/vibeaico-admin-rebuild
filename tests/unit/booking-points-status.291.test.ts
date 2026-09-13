/**
 * tests/unit/booking-points-status.291.test.ts — issue #291 的形狀鎖
 *
 * ⚠️ 這個檔讀的是**原始碼文字**，不是行為。它能證明「守門的那幾行寫在該在的位置」，
 * **證不到**「已取消的預約真的折不下去」——後者只有真 DB 才驗得了，見
 * `tests/integration/api/booking-points-status.291.test.ts`。
 *
 * 兩層各自鎖不同的東西：文字層鎖住「順序」與「白名單而非黑名單」這類容易在後續
 * 重構中被無聲改掉的性質；行為層鎖住「被擋時三個地方都沒變」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/**
 * 去掉 SQL 註解再比對——本檔幾條斷言在找某個片語的位置，而解釋「為什麼要這樣寫」
 * 的註解裡多半也有同一個片語。PB-027：數到的必須是可執行的那一份。
 * （#292 就是在一條專門鎖冪等的測試上，因為註解裡有同樣的字而讓變異存活。）
 */
const stripSqlComments = (code: string): string => code.replace(/^\s*--.*$/gm, '');

const route = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/bookings/[id]/apply-points/route.ts'), 'utf8',
));
const sql = stripSqlComments(readFileSync(
  resolve(ROOT, 'supabase/migrations/0093_booking_points_status_guard.sql'), 'utf8',
));
const fn = sql.slice(sql.indexOf('function public.redeem_booking_points'));
const body = fn.slice(0, fn.indexOf('language plpgsql'));

describe('0093：狀態閘門的形狀', () => {
  it('是 forward migration，沒有回頭改 0090', () => {
    // PB-015／PB-017：0090 已經套用過，只能往前補。
    const original = readFileSync(
      resolve(ROOT, 'supabase/migrations/0090_atomic_booking_points_redemption.sql'), 'utf8',
    );
    expect(original).not.toContain('BOOKING_NOT_ADJUSTABLE');
  });

  it('用白名單（PENDING / CONFIRMED），不是黑名單', () => {
    /**
     * 這條鎖的是一個真實的退化路徑：改成 `status in ('COMPLETED','CANCELLED','NO_SHOW')`
     * 的黑名單，今天行為完全一樣、所有測試全綠——但 `booking_status` 之後若新增
     * 列舉值（例如 REFUNDED），黑名單會**默默放行**它。
     */
    expect(body).toMatch(/status\s+not\s+in\s*\(\s*'PENDING'\s*,\s*'CONFIRMED'\s*\)/);
    expect(body).not.toMatch(/status\s+in\s*\(\s*'COMPLETED'/);
  });

  it('狀態檢查排在點數不足與金額超限之前', () => {
    // 否則店家會拿到「顧客點數不足」，跑去幫顧客加點，加完再試還是失敗——
    // 真正的問題從頭到尾沒被說出來。
    const guard = body.indexOf('BOOKING_NOT_ADJUSTABLE');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('POINTS_INSUFFICIENT'));
    expect(guard).toBeLessThan(body.indexOf('AMOUNT_EXCEEDED'));
  });

  it('狀態檢查排在「找不到預約」之後——不存在的預約仍該是 404', () => {
    const guard = body.indexOf('BOOKING_NOT_ADJUSTABLE');
    expect(body.indexOf('BOOKING_NOT_FOUND')).toBeLessThan(guard);
  });

  it('status 真的有被取出來（select 少一欄，上面那些位置斷言就都是空話）', () => {
    expect(body).toMatch(/select[\s\S]*b\.status[\s\S]*into\s+v_booking/);
  });

  it('沿用 0090 的兩道列鎖與自減寫法，沒有在重建時弄丟', () => {
    // `create or replace` 是整支重寫，很容易在複製時掉東西。
    expect((body.match(/for update/g) ?? []).length).toBe(2);
    expect(body).toContain('set final_price = bookings.final_price - p_points');
    expect(body).toContain('set points = points - p_points');
  });

  it('三段式撤銷都在（PB-028：只撤 anon/authenticated 擋不住 PUBLIC）', () => {
    expect(sql).toContain('revoke all on function public.redeem_booking_points(uuid, uuid, int) from public;');
    expect(sql).toContain('from anon, authenticated;');
    expect(sql).toContain('grant execute on function public.redeem_booking_points(uuid, uuid, int) to service_role;');
  });
});

describe('route：新錯誤碼的對映', () => {
  it('BOOKING_NOT_ADJUSTABLE → 409（狀態衝突，不是輸入錯誤）', () => {
    const i = route.indexOf('BOOKING_NOT_ADJUSTABLE');
    expect(i, '沒有處理 BOOKING_NOT_ADJUSTABLE').toBeGreaterThan(-1);
    expect(route.slice(i, i + 240)).toContain('409');
  });

  it('訊息說得出「為什麼」與「怎麼辦」', () => {
    // 只回「無法折抵」的話，店家看不出是狀態問題，會去改點數或改金額。
    const i = route.indexOf('BOOKING_NOT_ADJUSTABLE');
    const slice = route.slice(i, i + 240);
    expect(slice).toContain('無法再折抵');
    expect(slice).toContain('已確認');
  });

  it('既有四個錯誤碼的對映沒有被動到', () => {
    for (const [raised, status] of [
      ['BOOKING_NOT_FOUND', '404'],
      ['CUSTOMER_NOT_FOUND', '404'],
      ['POINTS_INSUFFICIENT', '409'],
      ['AMOUNT_EXCEEDED', '400'],
    ] as const) {
      const i = route.indexOf(raised);
      expect(i, `沒有處理 ${raised}`).toBeGreaterThan(-1);
      expect(route.slice(i, i + 160)).toContain(status);
    }
    expect(route).toContain("'POINTS_001'");
  });
});
