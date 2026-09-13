import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/staff/page.tsx');
const migration = read('supabase/migrations/0083_staff_display_fields.sql');
const mappers = read('src/server/mappers.ts');
const listRoute = read('src/app/api/staff/route.ts');
const itemRoute = read('src/app/api/staff/[id]/route.ts');
const mock = read('src/mock/index.ts');

/**
 * 顯示名稱／簡介／同時段最大預約數／前台顯示旗標原本是 staff 頁的頁內常數
 * （STAFF_EXTRAS_*，以 mock id 為鍵）。真實租戶的 id 是 uuid，所以那些常數永遠
 * 對不上，每位員工都靜默落到 DEFAULT_EXTRAS，顯示在他們真實的姓名與職稱旁邊。
 * 這是 issue #35 抓到的同一個缺陷家族。
 */
describe('staff 頁不得再用頁內常數餵欄位', () => {
  it('STAFF_EXTRAS_* 與 DEFAULT_EXTRAS 常數宣告都已移除', () => {
    for (const name of [
      'const STAFF_EXTRAS_LOCAL_SHOP',
      'const STAFF_EXTRAS_GUIDE',
      'const STAFF_EXTRAS_CLINIC',
      'const DEFAULT_EXTRAS',
    ]) {
      expect(page).not.toContain(name);
    }
  });

  it('頁面不再 import byMode（四個欄位已是後端真值）', () => {
    expect(page).not.toContain("import { byMode }");
  });

  it('toRow 直接讀 Staff 上的真欄位，且真值不會被預設值蓋掉', () => {
    expect(page).toContain("displayName: s.displayName ?? ''");
    expect(page).toContain('maxConcurrentBookings: s.maxConcurrentBookings ?? 1');
    expect(page).toContain('visible: s.visible ?? true');
  });
});

describe('0082 migration', () => {
  it('四個欄位都是 additive 且冪等', () => {
    for (const col of [
      'add column if not exists display_name text not null default',
      'add column if not exists bio text not null default',
      'add column if not exists max_concurrent_bookings integer not null default 1',
      'add column if not exists visible boolean not null default true',
    ]) {
      expect(migration).toContain(col);
    }
    expect(migration).not.toMatch(/drop\s+column/i);
  });

  it('max_concurrent_bookings 有 >= 1 的 check，且 check 本身受存在性判斷保護', () => {
    expect(migration).toContain('staff_max_concurrent_bookings_chk');
    expect(migration).toContain('check (max_concurrent_bookings >= 1)');
    expect(migration).toContain('from pg_constraint');
  });

  it('檔頭明說這不是 drift 補帳，而是真的新增欄位（已對正式庫查證為不存在）', () => {
    expect(migration).toContain('NOT a drift reconciliation');
    expect(migration).toContain('egehnijjpgijmccagxac');
  });
});

describe('讀寫兩端都接上真欄位', () => {
  it('mapper 讀回四個欄位，且 NULL 退回與 DB 預設值相同的解讀', () => {
    expect(mappers).toContain("displayName: r.display_name ?? ''");
    expect(mappers).toContain("bio: r.bio ?? ''");
    expect(mappers).toContain('maxConcurrentBookings: Number(r.max_concurrent_bookings ?? 1)');
    expect(mappers).toContain('visible: r.visible ?? true');
  });

  it('POST 與 PUT 都收這四個欄位', () => {
    for (const route of [listRoute, itemRoute]) {
      expect(route).toContain('displayName: z.string().optional()');
      expect(route).toContain('maxConcurrentBookings: z.number().int().min(1).optional()');
      expect(route).toContain('visible: z.boolean().optional()');
    }
    expect(listRoute).toContain('display_name: b.displayName');
    expect(itemRoute).toContain('update.display_name = b.displayName');
    expect(itemRoute).toContain('update.max_concurrent_bookings = b.maxConcurrentBookings');
  });

  it('maxConcurrentBookings 的下限 1 在 API 層也擋（不只靠 DB check）', () => {
    for (const route of [listRoute, itemRoute]) {
      expect(route).toContain('.int().min(1)');
    }
  });
});

/**
 * 業態風味不能消失：這個骨架被當成 demo 用，沙龍的簡介出現在導遊租戶底下
 * 是真的 bug（CLAUDE.md）。四個欄位改由 src/mock 依業態提供。
 */
describe('三個業態的示範資料各自保有自己的風味', () => {
  it.each([
    ['10 年剪燙染資歷，擅長韓系空氣感瀏海。', 'LOCAL_SHOP'],
    ['PADI 潛水長，10 年海域嚮導資歷，擅長賞鯨與浮潛行程。', 'GUIDE'],
    ['家庭醫學科主治醫師，專長慢性病長期追蹤與健康評估。', 'CLINIC'],
  ])('%s 仍在 mock 資料集中（%s）', (bio) => {
    expect(mock).toContain(bio);
  });

  it('那些字串已經不在頁面檔裡（確實是搬走而不是複製一份）', () => {
    expect(page).not.toContain('10 年剪燙染資歷');
    expect(page).not.toContain('PADI 潛水長');
    expect(page).not.toContain('家庭醫學科主治醫師');
  });
});
