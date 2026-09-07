/**
 * 旅遊訂單狀態機與 migration 契約 — 單元測試（issue #8-B）
 * -----------------------------------------------------------------------------
 * 這一檔守的是**不需要資料庫就能證明的那一半**：狀態機的合法轉換、名額釋放的
 * 判準、以及 migration／route 裡幾條「拿掉就會靜默出事」的不變量。
 * 真的扣名額、真的併發搶最後一席，在
 * `tests/integration/api/tour-orders.10.test.ts`。
 *
 * 為什麼要在單元層再守一次 migration 的內容：那支 migration 只會在
 * `local-isolated` 從 0001 建庫時被執行到，而它裡面最要命的兩件事
 * （`reserve_seats` 的檢查與扣減在同一句 update、四支 security definer 函式
 * 對 anon/authenticated 撤權）**拿掉之後整合測試不一定會紅**——
 * 併發測試在低負載的 CI 上可能剛好不撞在一起。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canTransitionTourOrder, shouldReleaseSeats } from '@/server/tour-domain';
import { ERR } from '@/server/http';

const ROOT = process.cwd();

/**
 * 去掉註解再比對。解釋「以前是這樣寫、現在不可以」的註解不該被當成違規程式碼
 * ——本檔幾條斷言正是在檢查某些字串**不得**出現，而那些字串多半會出現在說明
 * 它們為什麼被移除的註解裡。
 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION = 'supabase/migrations/0087_issue_8b_tour_orders.sql';
const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
const manualRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/tour-orders/manual/route.ts'), 'utf8',
));
const cancelRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/tour-orders/[id]/cancel/route.ts'), 'utf8',
));
const cron = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/cron/tour-order-expiry/route.ts'), 'utf8',
));

describe('狀態機（10 分冊 §3）', () => {
  const legal: [string, string][] = [
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'COMPLETED'],
    ['CONFIRMED', 'CANCELLED'],
  ];
  for (const [from, to] of legal) {
    it(`${from} → ${to} 合法`, () => {
      expect(canTransitionTourOrder(from as any, to as any)).toBe(true);
    });
  }

  const illegal: [string, string][] = [
    ['PENDING', 'COMPLETED'],     // 沒收款就出團＝跳過確認收款
    ['CONFIRMED', 'PENDING'],     // 不能倒退
    ['COMPLETED', 'CANCELLED'],   // 終態
    ['COMPLETED', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],   // 終態；取消後要重來只能開新單
    ['CANCELLED', 'COMPLETED'],
  ];
  for (const [from, to] of illegal) {
    it(`${from} → ${to} 不合法`, () => {
      expect(canTransitionTourOrder(from as any, to as any)).toBe(false);
    });
  }

  it('同狀態轉同狀態一律不合法（重複操作要回 409，不得靜默成功）', () => {
    for (const s of ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(canTransitionTourOrder(s, s)).toBe(false);
    }
  });

  it('只有還佔著名額的狀態才釋放名額', () => {
    expect(shouldReleaseSeats('PENDING')).toBe(true);
    expect(shouldReleaseSeats('CONFIRMED')).toBe(true);
    // 已取消再釋放一次＝名額憑空多出來；已完成的席次本來就被消耗掉
    expect(shouldReleaseSeats('CANCELLED')).toBe(false);
    expect(shouldReleaseSeats('COMPLETED')).toBe(false);
  });
});

describe('migration 0087 的關鍵不變量', () => {
  it('reserve_seats 的容量檢查與扣減在同一句 update（禁止應用層算庫存）', () => {
    const fn = sql.slice(sql.indexOf('function public.reserve_seats'));
    const body = fn.slice(0, fn.indexOf('language plpgsql'));
    // 一句 update 同時帶 set 與 where 的容量條件；先 select 再 update 會超賣
    expect(body).toMatch(/set\s+seats_booked\s*=\s*seats_booked\s*\+\s*p_count/);
    expect(body).toMatch(/seats_booked\s*\+\s*p_count\s*<=\s*capacity/);
    expect(body).toMatch(/status\s*=\s*'OPEN'/);
    expect(body).not.toMatch(/\bselect\b/i);
    // 沒扣到就 raise，呼叫端才知道自己失敗了
    expect(body).toContain("raise exception 'SEATS_UNAVAILABLE'");
  });

  it('create_tour_order 先扣名額再 insert，兩者同一交易', () => {
    const fn = sql.slice(sql.indexOf('function public.create_tour_order'));
    const body = fn.slice(0, fn.indexOf('language plpgsql'));
    const iReserve = body.indexOf('reserve_seats');
    const iInsert = body.indexOf('insert into public.tour_orders');
    expect(iReserve).toBeGreaterThan(-1);
    expect(iInsert).toBeGreaterThan(iReserve);
  });

  it('create_tour_order 自己驗租戶歸屬（security definer 繞過 RLS）', () => {
    const fn = sql.slice(sql.indexOf('function public.create_tour_order'));
    const body = fn.slice(0, fn.indexOf('language plpgsql'));
    expect(body).toContain('d.tenant_id = p_tenant');
    expect(body).toContain('p.tenant_id = p_tenant');
  });

  it('cancel_tour_order 擋掉終態，避免重複釋放名額', () => {
    const fn = sql.slice(sql.indexOf('function public.cancel_tour_order'));
    const body = fn.slice(0, fn.indexOf('language plpgsql'));
    expect(body).toMatch(/status in \('CANCELLED', 'COMPLETED'\)/);
    const iGuard = body.indexOf("status in ('CANCELLED', 'COMPLETED')");
    const iRelease = body.indexOf('release_seats');
    expect(iRelease).toBeGreaterThan(iGuard);
  });

  it('四支 security definer 函式都對 anon/authenticated 撤銷執行權', () => {
    for (const fn of ['reserve_seats', 'release_seats', 'create_tour_order', 'cancel_tour_order']) {
      const revoke = new RegExp(`revoke execute on function public\\.${fn}[\\s\\S]{0,200}?from anon, authenticated`);
      expect(sql, `${fn} 沒有撤權`).toMatch(revoke);
    }
  });

  it('tour_orders 開 RLS、有租戶政策，且撤銷 anon/authenticated 的直接 DML', () => {
    expect(sql).toContain('alter table public.tour_orders enable row level security');
    expect(sql).toContain('is_tenant_member(tenant_id)');
    expect(sql).toMatch(/revoke insert, update, delete, truncate on table public\.tour_orders/);
  });

  it('seats_booked 的區間約束仍由 0066 的 trip_departures 負責，本檔不重複定義', () => {
    // 這條是防止「兩個地方各寫一份約束、日後只改了一邊」
    expect(sql).not.toMatch(/seats_booked\s*>=\s*0\s*and/);
  });
});

describe('路由把 rpc 的業務結果翻成正確的 HTTP 語意', () => {
  it('名額不足 → 409 TOUR_001（10 分冊 §2 指定的錯誤碼）', () => {
    expect(ERR.SEATS_UNAVAILABLE).toBe('TOUR_001');
    expect(manualRoute).toContain('SEATS_UNAVAILABLE');
    expect(manualRoute).toMatch(/fail\(409,[^)]*ERR\.SEATS_UNAVAILABLE\)/);
  });

  it('建單走 rpc，不在路由裡自己 insert tour_orders（那會繞過原子扣減）', () => {
    expect(manualRoute).toContain("rpc('create_tour_order'");
    expect(manualRoute).not.toMatch(/from\('tour_orders'\)[\s\S]{0,80}\.insert\(/);
  });

  it('驗證在 feature 閘門之前（格式錯回 400 REQ_001，不是 403 FEAT_001）', () => {
    // 從 handler 本體開始找，否則 indexOf 會抓到檔頭的 import 那一行
    const body = manualRoute.slice(manualRoute.indexOf('export const POST'));
    const iParse = body.indexOf('manualTourOrderSchema.parse');
    const iFeature = body.indexOf('requireFeature(');
    expect(iParse, '沒有 parse 輸入').toBeGreaterThan(-1);
    expect(iFeature, '沒有 TOUR_MODULE 閘門').toBeGreaterThan(-1);
    expect(iFeature, '閘門必須在驗證之後').toBeGreaterThan(iParse);
  });

  it('手動單的 hold_expires_at 為 null（10 分冊 §3：不自動過期）', () => {
    expect(manualRoute).toMatch(/p_hold_expires:\s*null/);
  });

  it('取消走 rpc，不在路由裡自己 update 狀態＋release（那會變成兩個交易）', () => {
    expect(cancelRoute).toContain("rpc('cancel_tour_order'");
    expect(cancelRoute).not.toContain('release_seats');
    expect(cancelRoute).not.toMatch(/status:\s*'CANCELLED'/);
  });
});

/**
 * 「已付款」必須連同實收金額一起寫（issue #8-B，本輪被 CI 的 23514 抓出來）
 * -----------------------------------------------------------------------------
 * 初版的 confirm-payment 只寫 `payment_status = 'PAID'`，沒寫金額。
 * historical overlay 的 `tour_orders` 帶著 `#41` 加上的
 * `check (payment_status <> 'PAID' or paid_amount = total_amount)`，於是整合測試 500。
 *
 * **那個約束是對的**：一筆「已付款」而實收 0 元的訂單，就是這整張 issue 在修的那種
 * 假宣稱——畫面說收到錢了，資料庫裡沒有任何金額佐證。所以修的是路由與 canonical
 * schema，不是測試。
 *
 * 這一條在單元層再守一次，因為 canonical 安裝（沒有 overlay）少了那個約束時，
 * 只有 overlay 那一邊會紅——而 CI 可能哪天只跑 canonical。
 */
describe('付款狀態與實收金額必須一致', () => {
  const confirmRoute = withoutComments(readFileSync(
    resolve(ROOT, 'src/app/api/tour-orders/[id]/confirm-payment/route.ts'), 'utf8',
  ));

  it('confirm-payment 同時寫 payment_status 與 paid_amount', () => {
    expect(confirmRoute).toContain("payment_status: 'PAID'");
    expect(confirmRoute, "只翻旗標不寫金額＝『已付款』但實收 0 元").toMatch(/paid_amount:\s*current\.total_amount/);
  });

  it('金額取自 DB 的 total_amount，不是用戶端送來的值', () => {
    // 讀回 current 時必須把 total_amount 一起選出來
    expect(confirmRoute).toMatch(/\.select\('id, status, total_amount'\)/);
    // 不得從 request body 取金額——那等於讓呼叫端自己宣告收了多少錢
    expect(confirmRoute).not.toMatch(/await req\.json\(\)/);
  });

  it('canonical migration 也帶同一個不變量（否則只有 overlay 那一邊會紅）', () => {
    expect(sql).toContain('paid_amount');
    expect(sql).toMatch(/payment_status <> 'PAID' or paid_amount = total_amount/);
  });

  it('約束只在 historical 版本不存在時才建（同一條規則不得有兩份定義）', () => {
    const block = sql.slice(sql.indexOf('tour_orders_paid_amount_consistent') - 800);
    expect(block).toContain('tour_orders_payment_amounts_nonnegative');
    expect(block).toContain('pg_constraint');
  });
});

describe('逾期 cron 不再是佔位', () => {
  it('不再回「表還沒建」的 skipped', () => {
    expect(cron).not.toContain('tour tables not built');
    expect(cron).not.toMatch(/skipped:\s*true/);
  });

  it('只取消 PENDING 且已過期的單，且逐筆走同交易的 rpc', () => {
    expect(cron).toMatch(/\.eq\('status', 'PENDING'\)/);
    expect(cron).toMatch(/\.lt\('hold_expires_at'/);
    expect(cron).toContain("rpc('cancel_tour_order'");
  });

  it('不自己推導保留期限（只認建單端寫進 hold_expires_at 的值）', () => {
    // 出現 30 分鐘／3 天這類常數就代表 cron 又算了一次期限，兩邊規則會分歧
    expect(cron).not.toMatch(/30\s*\*\s*60|3\s*\*\s*24/);
  });

  it('仍然驗 Bearer（沒有驗證的 cron 等於一支公開的批次取消端點）', () => {
    expect(cron).toContain('CRON_SECRET');
    expect(cron).toMatch(/status:\s*401/);
  });
});

/**
 * `/tenant/tour-orders` 頁的寫入接線（issue #8-B）
 * -----------------------------------------------------------------------------
 * 這一段是本輪稽核抓到、而且**我自己先前記錯過**的一塊：#8 的留言原本寫著
 * 「tour-orders 頁本來就已接 service（實查 8 處引用）」。那 8 處在
 * `src/services/tours.ts` 裡，不在頁面裡。頁面的實況是四個寫入動作**一個都沒接**：
 *
 *     const runAction = () => {
 *       setRows((prev) => prev.map((o) => ({ ...o, status: 'CONFIRMED' })));  // 只動 state
 *       toast.show(t.messages.paymentConfirmed);                              // 就宣告成功
 *     };
 *
 * 而且更隱蔽的一層是：手動建單視窗的行程／方案／團次三個下拉讀的是頁內的
 * MOCK_TRIPS / MOCK_TRIP_PLANS / MOCK_TRIP_DEPARTURES —— 就算端點全部到位，
 * 店家選到的仍是示範資料的 id，送出去必然 404。下拉裡看得到選項、選得下去，
 * 只有送出那一刻才失敗，比「端點不存在」更難察覺。
 */
describe('tour-orders 頁的四個寫入動作真的打端點', () => {
  const page = withoutComments(readFileSync(
    resolve(ROOT, 'src/app/tenant/tour-orders/page.tsx'), 'utf8',
  ));

  it('四支寫入 service 都被頁面匯入', () => {
    const m = page.match(/import\s*\{([^}]*)\}\s*from\s*'@\/services\/tours'/);
    expect(m, '頁面沒有從 @/services/tours 匯入').not.toBeNull();
    const names = m![1].split(',').map((x) => x.trim());
    for (const fn of [
      'confirmTourOrderPayment', 'completeTourOrder', 'cancelTourOrder', 'createManualTourOrder',
    ]) {
      expect(names, `${fn} 沒有被匯入`).toContain(fn);
    }
  });

  it('狀態動作依 kind 呼叫對應的 service，不再用 setRows 偽造', () => {
    const start = page.indexOf('const runAction =');
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf('\n  const ', start + 1));
    expect(body).toContain('confirmTourOrderPayment(');
    expect(body).toContain('completeTourOrder(');
    expect(body).toContain('cancelTourOrder(');
    expect(body, 'runAction 還在用 setRows 偽造結果').not.toContain('setRows(');
  });

  it('建單走 createManualTourOrder，且不再自己組 TourOrder 物件塞進 rows', () => {
    const start = page.indexOf('const submitDraft =');
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf('\n  const ', start + 1));
    expect(body).toContain('createManualTourOrder(');
    expect(body, 'submitDraft 還在用 setRows 偽造結果').not.toContain('setRows(');
    // 編一個假的訂單編號是原本最誤導的一段：它長得跟真的一模一樣
    expect(body).not.toMatch(/orderNo:/);
  });

  it('runOrderAction 的順序是 fn → load → toast，失敗顯示 ApiError.message', () => {
    const start = page.indexOf('const runOrderAction =');
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf('\n  const ', start + 1));
    const iFn = body.indexOf('await fn()');
    const iLoad = body.indexOf('await load()');
    const iToast = body.indexOf('toast.show(');
    expect(iLoad, '成功後必須重讀').toBeGreaterThan(iFn);
    expect(iToast, '成功訊息必須在重讀之後').toBeGreaterThan(iLoad);
    expect(body).toContain('ApiError');
    expect(body).toContain('actionFailedPrefix');
  });

  it('建單視窗的行程／方案／團次來自真實 service，不是頁內 mock', () => {
    for (const fn of ['listTrips', 'listTripPlans', 'listTripDepartures']) {
      expect(page, `${fn} 沒有被使用`).toContain(`${fn}(`);
    }
    // ⚠️ 這三個常數只要還在，下拉就會給出示範資料的 id，送出必然 404
    for (const mock of ['MOCK_TRIPS', 'MOCK_TRIP_PLANS', 'MOCK_TRIP_DEPARTURES']) {
      expect(page, `${mock} 仍在頁面中`).not.toContain(mock);
    }
  });

  it('失敗時不關閉對話框（店家能重試）', () => {
    for (const handler of ['runAction', 'submitDraft']) {
      const start = page.indexOf(`const ${handler} =`);
      const body = page.slice(start, page.indexOf('\n  const ', start + 1));
      expect(body, `${handler} 沒有檢查 ok`).toMatch(/if \(ok\)|if \(!ok\) return/);
    }
  });
});
