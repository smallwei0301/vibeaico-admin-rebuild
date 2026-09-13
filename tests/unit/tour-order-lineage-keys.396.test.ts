import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #396 `0104_tour_order_lineage_keys.sql` 的契約測試。
 *
 * 這一檔把 `tour_orders` 的血統約束從「四條單欄 FK」升級成 canonical TEST 已有的
 * 複合鏈。它的風險不在於做錯什麼，而在於**做少了或做歪了都不會有人發現**：
 *
 *   - 只加強鍵、忘了拆弱鍵 → 兩支 FK 同時存在，PostgREST 的關聯變歧義，
 *     但 migration 回報成功。
 *   - delete 語意被順手改掉（restrict → cascade）→ 刪一個行程會連帶刪光訂單，
 *     而 schema diff 看起來只是「FK 換了名字」。
 *   - 方向做反（把 TEST 降到帳本的強度）→ 三邊確實「一致」了，只是一致在洞上。
 *
 * 本地已用 PostgreSQL 16 拋棄式叢集實測四條路徑：正式庫形狀升級後的 FK 集合與
 * canonical TEST 逐字相同、重跑為 no-op、跨租戶 insert 被拒、既有壞資料使 migration
 * 中止且 FK 原封不動。這個測試鎖住的是 SQL 檔本身不要在日後被改鬆。
 */
const executable = (sql: string) =>
  sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

const FILE = '0104_tour_order_lineage_keys.sql';
const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations', FILE), 'utf8');
const sql = executable(raw);

/** canonical TEST（nmwhwngojosmagjuvxol）2026-09-13 實查到的目標形狀。 */
const TARGET = [
  { parent: 'trips', child: ['tenant_id', 'trip_id'], deltype: 'r' },
  { parent: 'trip_plans', child: ['tenant_id', 'trip_id', 'plan_id'], deltype: 'r' },
  {
    parent: 'trip_departures',
    child: ['tenant_id', 'trip_id', 'plan_id', 'departure_id'],
    deltype: 'r',
  },
  { parent: 'customers', child: ['tenant_id', 'customer_id'], deltype: 'n' },
] as const;

describe('#396 tour_orders 血統複合鍵', () => {
  it('四個父表都被納入，且子鍵是複合的（不是單欄）', () => {
    for (const t of TARGET) {
      expect(sql, `${t.parent} 沒被處理`).toContain(`'${t.parent}'`);
      expect(sql, `${t.parent} 的子鍵欄位組不完整`).toContain(
        t.child.map((c) => `'${c}'`).join(','),
      );
      expect(t.child.length, `${t.parent} 的子鍵退化成單欄＝洞還在`).toBeGreaterThan(1);
    }
  });

  it('保留原本的 delete 語意——行程被刪不得連帶刪光訂單', () => {
    expect(sql).toContain("'RESTRICT'");
    expect(sql).toContain("'SET NULL (customer_id)'");
    // 顧客那條是 column-specific SET NULL：只清 customer_id，不得把 tenant_id 也清成 null。
    expect(sql, 'SET NULL 未指定欄位會連 tenant_id 一起清掉').not.toMatch(
      /ON DELETE SET NULL(?!\s*\(|')/,
    );
    expect(sql, '不得把任何一條血統 FK 改成 CASCADE').not.toMatch(/ON DELETE %s[\s\S]{0,80}CASCADE/);
  });

  it('先建強鍵並 VALIDATE，再拆弱鍵——不得留下空窗或雙鍵', () => {
    const add = sql.indexOf('ADD CONSTRAINT %I FOREIGN KEY');
    const validate = sql.indexOf('VALIDATE CONSTRAINT %I', add);
    const drop = sql.indexOf('DROP CONSTRAINT %I');
    expect(add, 'migration 沒有新增強鍵').toBeGreaterThan(-1);
    expect(validate, '新增的 NOT VALID 鍵沒有被 VALIDATE').toBeGreaterThan(add);
    expect(drop, '弱鍵沒有被拆掉——兩支並存會讓 PostgREST 關聯變歧義').toBeGreaterThan(validate);
  });

  it('先查資料再改結構，且不得「修正」資料', () => {
    expect(sql).toContain('TOUR_ORDER_LINEAGE_DATA_MISMATCH');
    const mismatch = sql.indexOf('TOUR_ORDER_LINEAGE_DATA_MISMATCH');
    expect(mismatch, '資料檢查必須在任何 ALTER 之前（PB-033）').toBeLessThan(
      sql.indexOf('ADD CONSTRAINT'),
    );
    for (const forbidden of ['delete from public.tour_orders', 'update public.tour_orders']) {
      expect(sql.toLowerCase(), `不得以改資料的方式讓約束通過：${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('已經是目標形狀時是 no-op（乾淨帳本重建與 canonical TEST 都會走這條）', () => {
    expect(sql, '缺少「已經是複合鍵就跳過」的分支＝在 TEST 上重跑會撞撞名').toContain('CONTINUE');
  });

  it('反向斷言：不得順手改動 RLS、角色權限或 tenant FK', () => {
    expect(sql).toContain('TOUR_ORDER_LINEAGE_RLS_CHANGED');
    expect(sql).toContain('TOUR_ORDER_LINEAGE_TENANT_FK_CHANGED');
    expect(sql).toContain('TOUR_ORDER_LINEAGE_FK_COUNT');
    for (const forbidden of ['grant ', 'revoke ', 'enable row level security', 'create policy']) {
      expect(sql.toLowerCase(), `本檔不得碰權限／RLS：${forbidden}`).not.toContain(forbidden);
    }
  });

  it('後置條件獨立重查，不信任前面的流程', () => {
    expect(sql).toContain('TOUR_ORDER_LINEAGE_POSTCONDITION');
    expect(
      sql.indexOf('TOUR_ORDER_LINEAGE_POSTCONDITION'),
      '後置檢查必須在 DDL 之後',
    ).toBeGreaterThan(sql.indexOf('DROP CONSTRAINT'));
  });

  it('整包在單一 DO 裡——CLI 沒有外層交易時仍是全有全無', () => {
    expect(raw).toContain('DO $lineage$');
    expect(raw).toContain('$lineage$;');
    expect(sql.match(/DO \$lineage\$/g)?.length, '不得拆成多個 DO').toBe(1);
  });

  it('不得重寫歷史 migration：0087 的建表語句保持原樣', () => {
    const original = readFileSync(
      resolve(process.cwd(), 'supabase/migrations', '0087_issue_8b_tour_orders.sql'),
      'utf8',
    );
    expect(original, '0087 被改動＝歷史被重寫').toContain(
      'trip_id           uuid not null references public.trips(id) on delete restrict',
    );
  });
});
