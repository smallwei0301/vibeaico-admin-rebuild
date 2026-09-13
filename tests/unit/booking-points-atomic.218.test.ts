/**
 * 預約點數折抵的原子性 — 單元測試（GitHub issue #218）
 * -----------------------------------------------------------------------------
 * 修改前 `POST /api/bookings/:id/apply-points` 做三件事，彼此沒有交易保護：
 *
 *   ① 扣 customers.points          ← 已有 CAS，擋得住點數的 lost update
 *   ② insert customer_point_logs
 *   ③ update bookings.final_price = 進函式時讀到的值 − points   ← **沒有 CAS**
 *
 * 兩個缺口，第一個是本 issue 的核心症狀：
 *
 * **A. `final_price` 沒有 CAS。** 兩個併發請求各折 30 點，①的 CAS 讓兩次扣點都成功
 *    （100 → 70 → 40，**點數真的少了 60**），但兩邊都把 final_price 寫成
 *    「讀到的 100 − 30 = 70」。**顧客付出 60 點，只換到 30 元折扣。**
 *    注意：只看點數的測試會全綠——CAS 那一半本來就是對的。
 *
 * **B. 三步不在同一交易。** ②或③失敗時，①扣掉的點數收不回來：顧客的點數消失，
 *    卻沒有折扣、也沒有帳本紀錄可查。
 *
 * 本檔守「不需要資料庫就能證明的那一半」：route 不再自己做三步、rpc 的鎖與算式、
 * 以及三道閘門的順序沒有被動到。真的併發、真的回滾在
 * `tests/integration/api/booking-points-atomic.218.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const route = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/bookings/[id]/apply-points/route.ts'), 'utf8',
));
const sql = readFileSync(
  resolve(ROOT, 'supabase/migrations/0090_atomic_booking_points_redemption.sql'), 'utf8',
);
/**
 * 去掉 SQL 註解再比對——本檔幾條斷言在數某個片語出現幾次，而解釋「為什麼要這樣寫」
 * 的註解裡多半也有同一個片語。（這正是 PB-027 的形狀：數名字出現次數之前，
 * 先確認數到的是不是可執行的那一份。）
 */
const stripSqlComments = (code: string): string =>
  code.replace(/^\s*--.*$/gm, '');

const fn = stripSqlComments(sql).slice(
  stripSqlComments(sql).indexOf('function public.redeem_booking_points'),
);
const body = fn.slice(0, fn.indexOf('language plpgsql'));

describe('route 不再自己做三步寫入', () => {
  it('走 redeem_booking_points rpc', () => {
    expect(route).toContain("rpc('redeem_booking_points'");
  });

  it('route 內不再有任何 customers / customer_point_logs / bookings 的寫入', () => {
    for (const table of ['customers', 'customer_point_logs', 'bookings']) {
      const write = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,120}?\\.(update|insert)\\(`);
      expect(route, `route 還在自己寫 ${table}`).not.toMatch(write);
    }
  });

  it('不再自己算 newFinal（那正是缺口 A 的來源）', () => {
    expect(route).not.toMatch(/newFinal/);
    expect(route).not.toMatch(/final_price\)\s*-\s*b\.points/);
  });
});

describe('三道閘門維持在 route 這一層，且順序不變', () => {
  it('requireTenant → requireFeature(POINT_SYSTEM) → 驗證 body → rpc', () => {
    const iTenant = route.indexOf('requireTenant()');
    const iFeature = route.indexOf("requireFeature(t.tenantId, 'POINT_SYSTEM')");
    const iParse = route.indexOf('bodySchema.parse');
    const iRpc = route.indexOf("rpc('redeem_booking_points'");
    expect(iTenant).toBeGreaterThan(-1);
    expect(iFeature).toBeGreaterThan(iTenant);
    expect(iParse).toBeGreaterThan(iFeature);
    expect(iRpc).toBeGreaterThan(iParse);
  });

  it('tenantId 取自伺服器端的 requireTenant()，不是請求 body', () => {
    expect(route).toMatch(/p_tenant:\s*t\.tenantId/);
    // body schema 只收 points，不得多收 tenantId／customerId 之類可偽造的欄位
    expect(route).toMatch(/bodySchema\s*=\s*z\.object\(\{\s*points:/);
    expect(route).not.toMatch(/tenantId:\s*z\./);
  });
});

describe('回應格式與錯誤語意逐字保留（#218：不自行改商業規則）', () => {
  it('仍回 { finalPrice, customerPoints }', () => {
    expect(route).toMatch(/finalPrice:/);
    expect(route).toMatch(/customerPoints:/);
  });

  const cases: [string, string][] = [
    ['BOOKING_NOT_FOUND', '404'],
    ['CUSTOMER_NOT_FOUND', '404'],
    ['POINTS_INSUFFICIENT', '409'],
    ['AMOUNT_EXCEEDED', '400'],
  ];
  for (const [raised, status] of cases) {
    it(`${raised} → ${status}`, () => {
      const i = route.indexOf(raised);
      expect(i, `沒有處理 ${raised}`).toBeGreaterThan(-1);
      expect(route.slice(i, i + 160)).toContain(status);
    });
  }

  it('點數不足仍用總表的 POINTS_001（不是通用 CONFLICT）', () => {
    expect(route).toContain("'POINTS_001'");
  });
});

describe('migration：兩個缺口各自的修法', () => {
  it('booking 與 customer 兩列都 for update（缺口 A 的核心）', () => {
    const locks = body.match(/for update/g) ?? [];
    expect(locks.length, '兩列都必須鎖，否則併發仍可能各自從舊值出發').toBe(2);
  });

  it('final_price 由資料庫自己讀自己算，不接受呼叫端算好的值', () => {
    // 右側限定 `bookings.` 是必要的，理由見本檔最後一組斷言（OUT 名稱撞名）。
    expect(body).toMatch(/set final_price = bookings\.final_price - p_points/);
    // 若出現「用參數當新值」的形狀，缺口 A 就回來了
    expect(body).not.toMatch(/set final_price = p_/);
  });

  it('扣點同樣是自減，不是寫入呼叫端算好的值', () => {
    expect(body).toMatch(/set points = points - p_points/);
  });

  it('三個寫入都在同一支函式內（＝同一交易，缺口 B 的修法）', () => {
    const iCustomer = body.indexOf('update public.customers');
    const iLog = body.indexOf('insert into public.customer_point_logs');
    const iBooking = body.indexOf('update public.bookings');
    for (const [name, i] of [['扣點', iCustomer], ['帳本', iLog], ['折價', iBooking]] as const) {
      expect(i, `${name} 不在 rpc 內`).toBeGreaterThan(-1);
    }
  });

  it('每一句都以 tenant_id = p_tenant 過濾（security definer 繞過 RLS）', () => {
    const filters = body.match(/tenant_id = p_tenant/g) ?? [];
    expect(filters.length).toBeGreaterThanOrEqual(4);
  });

  it('點數不足與金額不足各自 raise，不會靜默寫成負數', () => {
    expect(body).toContain("raise exception 'POINTS_INSUFFICIENT'");
    expect(body).toContain("raise exception 'AMOUNT_EXCEEDED'");
    const iGuard = body.indexOf("raise exception 'POINTS_INSUFFICIENT'");
    const iDeduct = body.indexOf('set points = points - p_points');
    expect(iDeduct, '守門必須在扣點之前').toBeGreaterThan(iGuard);
  });

  it('對 anon/authenticated 撤銷執行權（否則任何登入者可扣別家店顧客的點數）', () => {
    expect(sql).toMatch(
      /revoke all on function public\.redeem_booking_points\(uuid, uuid, int\)[\s\S]{0,60}from anon, authenticated/,
    );
  });
});

describe('RPC 執行權：撤到 PUBLIC，不只撤 anon/authenticated', () => {
  /**
   * PostgreSQL 對新建函式預設 grant EXECUTE 給 PUBLIC，而 anon / authenticated
   * 都是 PUBLIC 的成員——只撤這兩個角色，側門還開著。#271 的 Sol audit 在
   * `0087` 的四支 tour-order RPC 上抓到的就是這個洞（由 `0088` 補）。這一組斷言
   * 是為了讓同一個洞不會在第二個 SECURITY DEFINER RPC 上重演。
   */
  const acl = stripSqlComments(sql);
  const SIGNATURE = 'public.redeem_booking_points(uuid, uuid, int)';

  it('函式是 security definer（所以執行權才是安全邊界）', () => {
    expect(sql).toContain('security definer');
  });

  it('撤掉 PUBLIC 的預設 EXECUTE', () => {
    expect(acl, '沒有 revoke ... from public，瀏覽器仍叫得到這支 RPC').toMatch(
      new RegExp(`revoke all on function ${SIGNATURE.replace(/[()]/g, '\\$&')}\\s+from public`),
    );
  });

  it('仍然明確撤掉 anon 與 authenticated', () => {
    expect(acl).toMatch(
      new RegExp(`revoke all on function ${SIGNATURE.replace(/[()]/g, '\\$&')}\\s+from anon, authenticated`),
    );
  });

  it('只把 EXECUTE 給回 service_role', () => {
    expect(acl).toMatch(
      new RegExp(`grant execute on function ${SIGNATURE.replace(/[()]/g, '\\$&')}\\s+to service_role`),
    );
    const grants = acl.match(/grant execute on function[\s\S]*?;/g) ?? [];
    expect(grants.length, '不該有第二筆 grant').toBe(1);
    const grantStatement = grants[0] ?? '';
    const grantees = grantStatement.slice(grantStatement.lastIndexOf(' to ') + 4).replace(/;\s*$/, '');
    expect(grantees.trim(), 'EXECUTE 被授給了 service_role 以外的角色').toBe('service_role');
  });
});

describe('OUT 參數名與欄位名撞名（實際打過資料庫才會發現的那一類）', () => {
  /**
   * 本函式是 `returns table (final_price numeric, customer_points int)`，那兩個
   * OUT 名稱同時是 PL/pgSQL 變數。`set final_price = final_price - p_points` 的
   * 右側因此是歧義的，Postgres 會在**每一次呼叫**丟
   * `column reference "final_price" is ambiguous`——不是建立函式時，是執行時。
   *
   * 這條斷言是事後補的：第一版 CI 的 `local-isolated-a` 才抓到它，`apply-points`
   * 全數 500。本檔其餘斷言都是讀 SQL 文字，**讀文字證明不了執行期行為**——真正
   * 的證據是整合測試打一次真的資料庫。這一條只是把已知的那個踩點釘住，不要
   * 把它當成「這支函式跑得起來」的證明。
   */
  const OUT_NAMES = ['final_price', 'customer_points'];

  it('函式的 OUT 名稱確實與資料表欄位撞名（所以下面那條斷言有意義）', () => {
    const signature = stripSqlComments(sql).slice(
      stripSqlComments(sql).indexOf('returns table'),
      stripSqlComments(sql).indexOf('as $$'),
    );
    for (const name of OUT_NAMES) expect(signature).toContain(name);
  });

  it('UPDATE 的右側有限定資料表（bookings.final_price），不是裸的 final_price', () => {
    const updates = stripSqlComments(sql).match(/update\s+public\.bookings[\s\S]*?;/g) ?? [];
    expect(updates.length, '找不到對 bookings 的 update').toBeGreaterThanOrEqual(1);
    for (const stmt of updates) {
      const rhs = stmt.slice(stmt.indexOf('set'));
      expect(rhs, '右側是裸的 final_price，執行期會 ambiguous').toContain('bookings.final_price');
      expect(rhs, '右側仍有未限定的 final_price').not.toMatch(/=\s*final_price\b/);
    }
  });
});
