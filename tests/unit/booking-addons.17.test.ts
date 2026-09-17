/**
 * 預約加購（issue #17）—— 單元測試：不需要資料庫就能證明的那一半。
 * -----------------------------------------------------------------------------
 * 真的併發、真的回滾、真的冪等回放留在
 * `tests/integration/api/booking-addons.17.test.ts`（需要本機/canonical
 * TEST Supabase 才跑得動）。migration 本身（`create_booking_addon`／
 * `delete_booking_addon` 兩支 rpc 的鎖、冪等回放、回滾邊界、執行權撤銷）拆到
 * 獨立的 migration-only PR（`agent/issue-17-addons-migration`，見
 * `0121_issue_17_booking_addons_hardening.sql`），對應的 SQL 靜態驗證留在
 * 那支 PR 的 `tests/unit/booking-addons-migration.17.test.ts`，本檔不重複讀取
 * 該檔案（依 #530 staged schema release 政策，這支 PR 刻意不含任何
 * `supabase/migrations/**`）。
 *
 * 本檔守：
 *   ① route 不再自己做三步寫入，一律走 create_booking_addon／delete_booking_addon rpc；
 *   ② money/mode 驗證規則（price>=0、quantity>=1、SPECIFIC_STAFF 必填）確實存在；
 *   ③ 通知結果與加購成功分離（notify=false 時完全不呼叫 notifyBookingAddonReceipt）；
 *   ④ RPC 呼叫在 migration 尚未套用（函式/欄位不存在）時，route 有安全降級，
 *      不會讓整頁 500（見「schema 尚未就緒時的安全降級」describe）。
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

describe('schema 尚未就緒時的安全降級（migration 拆到獨立 PR，兩支 PR 合併順序不保證同時）', () => {
  it('GET：booking_addons 缺欄位（42703）時安全收斂成空陣列，不是 500', () => {
    expect(postRoute).toMatch(/42703/);
    expect(postRoute).toMatch(/return ok\(\[\]\)/);
  });

  it('GET：select 內嵌的 performance_staff_id FK 關聯缺失（PostgREST PGRST200）時同樣收斂成空陣列，不是 500', () => {
    // select 內嵌了 `performance:staff!booking_addons_performance_staff_id_fkey(name)`，
    // 這個 FK 由 0121 建立；尚未套用時 PostgREST 對「relationship not found」
    // 回的是 PGRST200，不是 42703——兩個錯誤碼都要收斂成 ok([])，缺一個就會讓
    // GET 在 migration 尚未套用的環境上炸成未分類 500。
    expect(postRoute).toMatch(/PGRST200/);
    const i = postRoute.indexOf("from('booking_addons')\n    .select(ADDON_SELECT)");
    expect(i, '找不到 booking_addons 的 GET select 區塊').toBeGreaterThan(-1);
    const block = postRoute.slice(i, postRoute.indexOf('return ok((data', i));
    expect(block).toMatch(/code === '42703' \|\| code === 'PGRST200'/);
    expect(block).toContain('return ok([])');
  });

  it('POST：找不到 create_booking_addon rpc（PGRST202/42883）時回可讀的 503，不是未分類 500', () => {
    expect(postRoute).toMatch(/PGRST202|42883/);
    expect(postRoute).toMatch(/尚未上線|尚未啟用/);
  });

  it('DELETE：找不到 delete_booking_addon rpc 時同樣回可讀的 503', () => {
    expect(deleteRoute).toMatch(/PGRST202|42883/);
    expect(deleteRoute).toMatch(/尚未上線|尚未啟用/);
  });
});
