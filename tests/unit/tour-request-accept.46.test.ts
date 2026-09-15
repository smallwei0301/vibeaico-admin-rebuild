/**
 * GUIDE 側接受／拒絕 REQUEST 訂單 — 單元測試（issue #46）
 * -----------------------------------------------------------------------------
 * 這一檔守的是「不需要資料庫就能證明的那一半」：
 *   - `0111` migration 的關鍵不變量（create_tour_order 依 sales_mode 分流、
 *     accept/reject 兩支 rpc 的前提檢查與釋放/鎖位條件、ACL）。
 *   - 兩支新路由把 rpc 的業務錯誤翻成正確的 HTTP 語意，且不繞過 rpc 自己
 *     dml。
 *
 * 真的重查名額、真的併發搶最後一席、真的驗證「送出申請不鎖名額」這條 owner
 * 決策，在 `tests/integration/api/tour-request-accept.46.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ERR } from '@/server/http';
import { acceptTourRequestSchema, rejectTourRequestSchema } from '@/server/tour-domain';

const ROOT = process.cwd();
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = 'supabase/migrations/0111_issue_46_guide_request_accept.sql';
const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
const acceptRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/tour-orders/[id]/accept/route.ts'), 'utf8',
));
const rejectRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/tour-orders/[id]/reject/route.ts'), 'utf8',
));

describe('acceptTourRequestSchema / rejectTourRequestSchema', () => {
  it('holdHours 可省略（省略時交由 rpc 用 plan 的預設值）', () => {
    expect(acceptTourRequestSchema.parse({})).toEqual({});
  });

  it('holdHours 必須是正數，且不得超過 168（7 天）的防呆上限', () => {
    expect(() => acceptTourRequestSchema.parse({ holdHours: 0 })).toThrow();
    expect(() => acceptTourRequestSchema.parse({ holdHours: -1 })).toThrow();
    expect(() => acceptTourRequestSchema.parse({ holdHours: 169 })).toThrow();
    expect(acceptTourRequestSchema.parse({ holdHours: 6 })).toEqual({ holdHours: 6 });
  });

  it('reject 的 reason 為選填文字', () => {
    expect(rejectTourRequestSchema.parse({})).toEqual({});
    expect(rejectTourRequestSchema.parse({ reason: '時段衝突' })).toEqual({ reason: '時段衝突' });
  });
});

describe('ERR.TOUR_REQUEST_NOT_ELIGIBLE 對映', () => {
  it('是 TOUR_002，且與名額不足的 TOUR_001 不同碼', () => {
    expect(ERR.TOUR_REQUEST_NOT_ELIGIBLE).toBe('TOUR_002');
    expect(ERR.TOUR_REQUEST_NOT_ELIGIBLE).not.toBe(ERR.SEATS_UNAVAILABLE);
  });
});

describe('migration 0111 的關鍵不變量', () => {
  it('create_tour_order 依 sales_mode 分流：REQUEST 不在建單當下 reserve_seats', () => {
    const fn = sql.slice(sql.indexOf('function public.create_tour_order'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    expect(body).toMatch(/v_should_reserve\s*:=\s*coalesce\(v_plan\.sales_mode,\s*'FIXED_DEPARTURE'\)\s*<>\s*'REQUEST'/);
    expect(body).toMatch(/if\s+v_should_reserve\s+then/i);
    // insert 必須把 seats_reserved 一起寫，不能讓它悄悄維持欄位預設值
    expect(body).toContain('seats_reserved');
  });

  it('create_tour_order 的簽章沒有改變（不得意外新增 overload，見 0099 教訓）', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.create_tour_order'));
    const signature = fn.slice(0, fn.indexOf(') returns uuid'));
    for (const param of [
      'p_tenant        uuid', 'p_order_no      text', 'p_departure     uuid',
      'p_party_size    int', 'p_customer      uuid', 'p_contact       jsonb',
      'p_source        public.tour_order_source', 'p_payment_method uuid',
      'p_note          text', 'p_hold_expires  timestamptz',
    ]) {
      expect(signature).toContain(param);
    }
  });

  it('accept_tour_request：三個前提在同一個 row lock 底下求值', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_tour_request'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    const iSelect = body.indexOf('select o.id');
    const iLock = body.indexOf('for update of o');
    const iPendingCheck = body.indexOf("status <> 'PENDING'");
    const iModeCheck = body.indexOf("sales_mode <> 'REQUEST'");
    expect(iSelect).toBeGreaterThan(-1);
    expect(iLock).toBeGreaterThan(iSelect);
    expect(iPendingCheck).toBeGreaterThan(iLock);
    expect(iModeCheck).toBeGreaterThan(iLock);
  });

  it('accept_tour_request：只有尚未鎖位才呼叫 reserve_seats（不重複鎖位）', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_tour_request'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    expect(body).toMatch(/if\s+not\s+v_order\.seats_reserved\s+then\s*\n\s*perform\s+public\.reserve_seats/);
  });

  it('accept_tour_request：hold_expires_at 由 plan 預設或覆寫值算出，不留給呼叫端自己算', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_tour_request'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    expect(body).toMatch(/v_hours\s*:=\s*coalesce\(p_hold_hours,\s*v_order\.request_hold_hours\)/);
    expect(body).toMatch(/hold_expires_at\s*=\s*now\(\)\s*\+\s*\(v_hours::double precision \* interval '1 hour'\)/);
  });

  it('accept_tour_request：轉態沿用既有狀態機（PENDING → CONFIRMED），不新增列舉值', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_tour_request'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    expect(body).toMatch(/status\s*=\s*'CONFIRMED'/);
    expect(sql).not.toMatch(/create type public\.tour_order_status/);
  });

  it('reject_tour_request：只在 seats_reserved 為真時才 release_seats', () => {
    const fn = sql.slice(sql.indexOf('function public.reject_tour_request'));
    const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
    expect(body).toMatch(/if\s+v_order\.seats_reserved\s+then\s*\n\s*perform\s+public\.release_seats/);
  });

  it('accept/reject 都自己驗租戶歸屬與 sales_mode（security definer 繞過 RLS）', () => {
    for (const fnName of ['accept_tour_request', 'reject_tour_request']) {
      const fn = sql.slice(sql.indexOf(`function public.${fnName}`));
      const body = fn.slice(0, fn.indexOf('$$ language plpgsql'));
      expect(body).toContain('o.tenant_id = p_tenant');
      expect(body).toContain('p.tenant_id = o.tenant_id');
    }
  });

  it('accept_tour_request／reject_tour_request 都對 anon/authenticated 撤權、只留 service_role', () => {
    for (const fnName of ['accept_tour_request', 'reject_tour_request']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fnName}[\\s\\S]{0,120}?from anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fnName}[\\s\\S]{0,60}?to service_role`));
    }
  });

  it('trip_plans.request_hold_hours 有正數且合理上限的 CHECK（單一設定來源，避免打字錯誤失控）', () => {
    expect(sql).toMatch(/request_hold_hours numeric not null default 12/);
    expect(sql).toMatch(/check\s*\(request_hold_hours\s*>\s*0\s*and\s*request_hold_hours\s*<=\s*168\)/);
  });

  it('tour_orders.seats_reserved 預設 true（既有資料與非 REQUEST 訂單的既成事實）', () => {
    expect(sql).toMatch(/seats_reserved boolean not null default true/);
  });

  it('後置斷言涵蓋 create_tour_order 唯一性、簽章與 sales_mode 分流三件事', () => {
    const assertion = sql.slice(sql.indexOf('後置斷言（PB-026'));
    expect(assertion).toContain("proname = 'create_tour_order'");
    expect(assertion).toMatch(/v_n\s*<>\s*1/);
    expect(assertion).toContain('0099 canonical');
  });
});

describe('路由把 rpc 的業務結果翻成正確的 HTTP 語意', () => {
  it('accept：ORDER_NOT_ELIGIBLE → 409 TOUR_002', () => {
    expect(acceptRoute).toContain('ORDER_NOT_ELIGIBLE');
    expect(acceptRoute).toMatch(/fail\(409,[^)]*ERR\.TOUR_REQUEST_NOT_ELIGIBLE\)/);
  });

  it('accept：SEATS_UNAVAILABLE → 409 TOUR_001（時段已被其他案件取得）', () => {
    expect(acceptRoute).toContain('SEATS_UNAVAILABLE');
    expect(acceptRoute).toMatch(/fail\(409,[^)]*ERR\.SEATS_UNAVAILABLE\)/);
  });

  it('accept：ORDER_NOT_FOUND → 404', () => {
    expect(acceptRoute).toContain('ORDER_NOT_FOUND');
    expect(acceptRoute).toMatch(/fail\(404,/);
  });

  it('accept 走 rpc，不在路由裡自己 update 狀態或 reserve_seats（那會繞過原子重查）', () => {
    expect(acceptRoute).toContain("rpc('accept_tour_request'");
    expect(acceptRoute).not.toContain('reserve_seats');
    expect(acceptRoute).not.toMatch(/status:\s*'CONFIRMED'/);
  });

  it('reject 走 rpc，不在路由裡自己 update 狀態或 release_seats（那會變成兩個交易）', () => {
    expect(rejectRoute).toContain("rpc('reject_tour_request'");
    expect(rejectRoute).not.toContain('release_seats');
    expect(rejectRoute).not.toMatch(/status:\s*'CANCELLED'/);
  });

  it('reject 回 false → 409 TOUR_002，不是靜默成功', () => {
    expect(rejectRoute).toMatch(/rejected\s*!==\s*true/);
    expect(rejectRoute).toMatch(/fail\(409,[^)]*ERR\.TOUR_REQUEST_NOT_ELIGIBLE\)/);
  });

  it('accept／reject 都先過 TOUR_MODULE 閘門，且用 requireTenantManager（同 confirm-payment/cancel 慣例）', () => {
    for (const route of [acceptRoute, rejectRoute]) {
      expect(route).toContain('requireTenantManager()');
      expect(route).toContain("requireFeature(t.tenantId, 'TOUR_MODULE')");
    }
  });
});
