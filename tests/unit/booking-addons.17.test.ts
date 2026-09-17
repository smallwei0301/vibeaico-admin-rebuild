/**
 * 預約加購（issue #17）—— 單元測試：不需要資料庫就能證明的那一半。
 * -----------------------------------------------------------------------------
 * 真的併發、真的回滾、真的冪等回放留在
 * `tests/integration/api/booking-addons.17.test.ts`（需要本機/canonical
 * TEST Supabase 才跑得動）。本檔守：
 *
 *   ① route 不再自己做三步寫入，一律走 create_booking_addon／delete_booking_addon rpc；
 *   ② money/mode 驗證規則（price>=0、quantity>=1、SPECIFIC_STAFF 必填）確實存在；
 *   ③ 0119 migration 的兩支 rpc 有鎖、有冪等回放、有回滾邊界、有正確的執行權撤銷；
 *   ④ 通知結果與加購成功分離（notify=false 時完全不呼叫 notifyBookingAddonReceipt）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const postRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/bookings/[id]/addons/route.ts'), 'utf8',
));
const deleteRoute = withoutComments(readFileSync(
  resolve(ROOT, 'src/app/api/bookings/[id]/addons/[addonId]/route.ts'), 'utf8',
));
const sql = readFileSync(
  resolve(ROOT, 'supabase/migrations/0119_issue_17_booking_addons_hardening.sql'), 'utf8',
);
const stripSqlComments = (code: string): string => code.replace(/^\s*--.*$/gm, '');
const strippedSql = stripSqlComments(sql);

function sqlFunctionBody(name: string): string {
  const start = strippedSql.indexOf(`function public.${name}`);
  expect(start, `找不到 function ${name}`).toBeGreaterThan(-1);
  const fn = strippedSql.slice(start);
  return fn.slice(0, fn.indexOf('$$ language plpgsql'));
}

const createFn = sqlFunctionBody('create_booking_addon');
const deleteFn = sqlFunctionBody('delete_booking_addon');

describe('POST route 不自己做三步寫入，一律走 create_booking_addon rpc', () => {
  it("呼叫 admin.rpc('create_booking_addon'", () => {
    expect(postRoute).toContain("rpc('create_booking_addon'");
  });

  it('route 內不直接 insert booking_addons，也不直接寫 bookings（金額/時長只能由 rpc 套用）', () => {
    expect(postRoute, 'route 還在自己 insert booking_addons').not.toMatch(/from\('booking_addons'\)[\s\S]{0,120}?\.insert\(/);
    expect(postRoute, 'route 還在自己 update/insert bookings').not.toMatch(/from\('bookings'\)[\s\S]{0,120}?\.(update|insert)\(/);
  });

  it('對 booking_addons 唯一允許的直接 update，只有事後寫回真實通知結果（notified 欄）', () => {
    const updates = postRoute.match(/from\('booking_addons'\)[\s\S]{0,120}?\.update\(\{[\s\S]{0,60}?\}\)/g) ?? [];
    for (const u of updates) expect(u).toContain('notified');
  });

  it('tenantId 取自伺服器端 requireTenant()，不是請求 body', () => {
    expect(postRoute).toMatch(/p_tenant:\s*t\.tenantId/);
    expect(postRoute).not.toMatch(/tenantId:\s*z\./);
  });

  it('SPECIFIC_STAFF 以外一律把 p_performance_staff_id 收斂成 null（不接受呼叫端亂塞）', () => {
    expect(postRoute).toMatch(
      /p_performance_staff_id:\s*b\.performanceMode === 'SPECIFIC_STAFF' \? b\.performanceStaffId : null/,
    );
  });
});

describe('POST body schema：money/mode 規則存在於 zod 層', () => {
  it('price 下限 0（拒絕負數），quantity 為正整數，durationMinutes 下限 0', () => {
    expect(postRoute).toMatch(/price:\s*z\.number\(\)\.min\(0/);
    expect(postRoute).toMatch(/quantity:\s*z\.number\(\)\.int\(\)\.positive\(/);
    expect(postRoute).toMatch(/durationMinutes:\s*z\.number\(\)\.int\(\)\.min\(0/);
  });

  it('performanceMode 限定三個值，且 SPECIFIC_STAFF 時 refine 要求 performanceStaffId', () => {
    expect(postRoute).toMatch(/z\.enum\(\['INHERIT', 'SPECIFIC_STAFF', 'NONE'\]\)/);
    expect(postRoute).toMatch(/performanceMode !== 'SPECIFIC_STAFF' \|\| !!v\.performanceStaffId/);
  });

  it('idempotencyKey 為必填字串', () => {
    expect(postRoute).toMatch(/idempotencyKey:\s*z\.string\(\)\.trim\(\)\.min\(1/);
  });
});

describe('通知與加購成功分離（issue #17 §6 裁示）', () => {
  it('只有非回放（!row.replayed）且 notify=true 才呼叫 notifyBookingAddonReceipt', () => {
    const i = postRoute.indexOf('if (!row.replayed)');
    expect(i).toBeGreaterThan(-1);
    const block = postRoute.slice(i, postRoute.indexOf('} else {', i));
    expect(block).toContain('if (b.notify)');
    expect(block).toContain('notifyBookingAddonReceipt');
  });

  it('回放（replayed=true）不重新呼叫 notifyBookingAddonReceipt，只讀回既有 notified', () => {
    const i = postRoute.indexOf('} else {');
    const block = postRoute.slice(i, postRoute.lastIndexOf('return ok('));
    expect(block).not.toContain('notifyBookingAddonReceipt');
  });
});

describe('DELETE route 走 delete_booking_addon rpc，只回沖該筆自己的量', () => {
  it("呼叫 admin.rpc('delete_booking_addon'", () => {
    expect(deleteRoute).toContain("rpc('delete_booking_addon'");
  });

  it('刪除前先確認 addonId 屬於這一筆 booking（避免用別筆 booking 的 addonId 誤刪）', () => {
    expect(deleteRoute).toMatch(/addon\.booking_id !== id/);
  });
});

describe('0119 migration：C+ 業績三態', () => {
  it('performance_mode 限定 INHERIT/SPECIFIC_STAFF/NONE 三值', () => {
    expect(strippedSql).toMatch(
      /performance_mode = any \(array\['INHERIT'::text, 'SPECIFIC_STAFF'::text, 'NONE'::text\]\)/,
    );
  });

  it('一致性 check：SPECIFIC_STAFF 必有 performance_staff_id；NONE 必為 null', () => {
    expect(strippedSql).toContain("performance_mode = 'SPECIFIC_STAFF' and performance_staff_id is not null");
    expect(strippedSql).toContain("performance_mode = 'NONE' and performance_staff_id is null");
  });

  it('create rpc：INHERIT 時 v_resolved_staff 取自鎖定後的 booking.staff_id（snapshot）', () => {
    expect(createFn).toMatch(/elsif p_performance_mode = 'INHERIT' then\s*\n\s*v_resolved_staff := v_booking\.staff_id;/);
  });

  it('create rpc：SPECIFIC_STAFF 驗證同租戶合法 staff，否則 raise', () => {
    expect(createFn).toContain("raise exception 'PERFORMANCE_STAFF_NOT_FOUND'");
    expect(createFn).toMatch(/select 1 from public\.staff where id = p_performance_staff_id and tenant_id = p_tenant/);
  });
});

describe('0119 migration：金額／數量規則（Owner 已裁示，price=0 允許、負數與 quantity<=0 拒絕）', () => {
  it('create rpc 有對應守門', () => {
    expect(createFn).toContain("raise exception 'PRICE_INVALID'");
    expect(createFn).toMatch(/p_price is null or p_price < 0/);
    expect(createFn).toContain("raise exception 'QUANTITY_INVALID'");
    expect(createFn).toMatch(/p_quantity is null or p_quantity <= 0/);
  });

  it('price=0 不落在守門條件內（不得被拒絕）', () => {
    expect(createFn).not.toMatch(/p_price is null or p_price <= 0/);
  });
});

describe('0119 migration：冪等收據', () => {
  it('同租戶內唯一，跨租戶不共用（tenant_id, idempotency_key）', () => {
    expect(strippedSql).toMatch(
      /create unique index if not exists ux_booking_addons_tenant_idempotency\s*\n\s*on public\.booking_addons \(tenant_id, idempotency_key\)/,
    );
  });

  it('刪除是軟刪（deleted_at），不是 delete from —— 否則唯一索引會隨列消失，同把 key 可重新落地', () => {
    expect(strippedSql).not.toMatch(/delete from public\.booking_addons/);
    expect(deleteFn).toContain('set deleted_at = now()');
  });

  it('create rpc：查無收據才鎖 booking；已有收據（含已刪除）直接回放，不重新驗證/套用', () => {
    const i = createFn.indexOf('if found then');
    expect(i).toBeGreaterThan(-1);
    const replayBlock = createFn.slice(i, createFn.indexOf('end if;', i));
    expect(replayBlock).toContain('true');
    expect(replayBlock).not.toContain('for update');
  });

  it('create rpc：insert 撞 unique_violation 時回放贏家收據，不重複套用金額', () => {
    expect(createFn).toContain('exception when unique_violation then');
    const i = createFn.indexOf('exception when unique_violation then');
    const block = createFn.slice(i, createFn.indexOf('end;', i));
    expect(block).not.toMatch(/update public\.bookings/);
  });

  it('delete rpc：鎖住該筆 addon 列，已刪除者直接回放 already_deleted=true，不二次回沖', () => {
    expect(deleteFn).toMatch(/select \* into v_addon from public\.booking_addons[\s\S]*?for update;/);
    const i = deleteFn.indexOf('if v_addon.deleted_at is not null then');
    expect(i).toBeGreaterThan(-1);
    const block = deleteFn.slice(i, deleteFn.indexOf('end if;', i));
    expect(block).toContain('true');
    expect(block).not.toMatch(/update public\.bookings/);
  });
});

describe('0119 migration：回沖不重算整張 booking，且不得降成負數', () => {
  it('delete rpc 用 greatest(...,0) 收斂下界，並嚴格減回該筆自己的 applied_amount/applied_minutes', () => {
    expect(deleteFn).toMatch(/final_price\s*=\s*greatest\(bookings\.final_price - v_addon\.applied_amount, 0\)/);
    expect(deleteFn).toMatch(/duration_minutes\s*=\s*greatest\(bookings\.duration_minutes - v_addon\.applied_minutes, 0\)/);
  });

  it('create rpc 用自加寫法（bookings.final_price + …），不是覆蓋絕對值', () => {
    expect(createFn).toMatch(/final_price\s*=\s*bookings\.final_price \+ v_applied_amount/);
  });
});

describe('兩支 rpc 都是 security definer，且執行權只留 service_role', () => {
  for (const name of ['create_booking_addon', 'delete_booking_addon'] as const) {
    it(`${name}：revoke public/anon/authenticated + grant service_role`, () => {
      const revokePublic = new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,120}?\\)\\s+from public;`);
      const revokeAuthed = new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,120}?\\)\\s+from anon, authenticated;`);
      const grantService = new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]{0,120}?\\)\\s+to service_role;`);
      expect(strippedSql, `${name} 缺少 revoke ... from public`).toMatch(revokePublic);
      expect(strippedSql, `${name} 缺少 revoke ... from anon, authenticated`).toMatch(revokeAuthed);
      expect(strippedSql, `${name} 缺少 grant ... to service_role`).toMatch(grantService);
    });
  }

  it('兩支函式都宣告 security definer', () => {
    const occurrences = strippedSql.match(/language plpgsql security definer/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});
