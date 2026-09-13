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
 * ## 為什麼整檔重寫（Final Risk 覆核發現）
 *
 * 舊版本大量使用「整檔字串搜尋」（`sql.toContain(...)`），對一份幾百行、有兩個
 * 結構相同 VALUES 區塊（施工用與後置條件用）的檔案完全沒有鑑別力：任何一個
 * 區塊裡出現過的子字串，都能讓針對「另一個」區塊的斷言通過。複覆核者實測 4 個
 * 突變（trips 的 delete 語意改成 CASCADE、trips 子鍵退化成單欄、資料前置檢查被
 * `IF false` 架空、後置 FK 數量檢查被 `IF false` 架空）全部通過舊測試的 9 個案例。
 *
 * 這一版改成：先各自定位「施工 VALUES 區塊」與「後置條件 VALUES 區塊」，分別
 * 逐欄解析成結構化資料再斷言，兩個區塊互不借用對方的內容；前置檢查與計數檢查
 * 則直接鎖住其精確的判斷式文字，而不是只鎖住錯誤字串本身存在。
 *
 * 本地已用 PostgreSQL 16 拋棄式叢集實測：正式庫形狀升級後的 FK 集合與本檔標頭
 * 記載的 canonical TEST 形狀逐欄相同、重跑為 no-op、跨租戶 insert 被拒、既有壞
 * 資料使 migration 中止且 FK 原封不動；父表先鎖的新鎖序在與 `create_tour_order`
 * 的寫入順序模擬對撞時不再讓應用層那筆訂單被判死。這個測試鎖住的是 SQL 檔本身
 * 不要在日後被改鬆。
 */
const FILE = '0104_tour_order_lineage_keys.sql';
const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations', FILE), 'utf8');
const sql = raw.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

type FkTuple = {
  parent: string;
  fkName: string;
  childCols: string[];
  parentCols: string[];
  deleteAction: string;
  deltype: string;
  nullCol: string;
};
type PostTuple = {
  parent: string;
  childCols: string[];
  parentCols: string[];
  deltype: string;
  expectSetNullCol: string | null;
};
type ColShapeTuple = { relName: string; colName: string; nullableOk: boolean };
type UniqueKeyTuple = { parentTable: string; keyName: string; keyCols: string[] };

const arr = (raw: string) => raw.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));

/**
 * 定位「單一」`FOR spec IN SELECT * FROM (VALUES ... ) AS e(<簽章>)` 迴圈的本體。
 * 用 AS 子句的欄位簽章當錨點——那是語意層的識別碼，不是排版；往前找最近一個
 * `FOR spec IN SELECT * FROM (VALUES` 當起點，兩者之間才是這個迴圈自己的內容,
 * 不會被檔案裡其他同結構的迴圈污染。
 */
function extractLoopBody(text: string, asSignature: string): string {
  const asIdx = text.indexOf(asSignature);
  if (asIdx === -1) throw new Error(`AS 子句找不到：${asSignature}`);
  const startIdx = text.slice(0, asIdx).lastIndexOf('FOR spec IN SELECT * FROM (VALUES');
  if (startIdx === -1) throw new Error(`對應的 VALUES 起點找不到：${asSignature}`);
  return text.slice(startIdx, asIdx);
}

function parseFkTuples(body: string): FkTuple[] {
  const re = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*ARRAY\[([^\]]*)\]\s*,\s*ARRAY\[([^\]]*)\]\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/gs;
  return [...body.matchAll(re)].map((m) => ({
    parent: m[1],
    fkName: m[2],
    childCols: arr(m[3]),
    parentCols: arr(m[4]),
    deleteAction: m[5],
    deltype: m[6],
    nullCol: m[7],
  }));
}

function parsePostTuples(body: string): PostTuple[] {
  const re = /\(\s*'([^']*)'\s*,\s*ARRAY\[([^\]]*)\]\s*,\s*ARRAY\[([^\]]*)\]\s*,\s*'([^']*)'\s*,\s*(NULL::text|'[^']*')\s*\)/gs;
  return [...body.matchAll(re)].map((m) => ({
    parent: m[1],
    childCols: arr(m[2]),
    parentCols: arr(m[3]),
    deltype: m[4],
    expectSetNullCol: m[5] === 'NULL::text' ? null : m[5].replace(/^'|'$/g, ''),
  }));
}

function parseColShapeTuples(body: string): ColShapeTuple[] {
  const re = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*\)/gs;
  return [...body.matchAll(re)].map((m) => ({
    relName: m[1],
    colName: m[2],
    nullableOk: m[3] === 'true',
  }));
}

function parseUniqueKeyTuples(body: string): UniqueKeyTuple[] {
  const re = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*ARRAY\[([^\]]*)\]\s*\)/gs;
  return [...body.matchAll(re)].map((m) => ({
    parentTable: m[1],
    keyName: m[2],
    keyCols: arr(m[3]),
  }));
}

const fkBody = extractLoopBody(
  raw,
  'AS e(parent_table, fk_name, child_cols, parent_cols, delete_action, deltype, null_col)',
);
const postBody = extractLoopBody(raw, 'AS e(parent_table, child_cols, parent_cols, deltype, expect_set_null_col)');
const colShapeBody = extractLoopBody(raw, 'AS e(rel_name, col_name, nullable_ok)');
const uniqueKeyBody = extractLoopBody(raw, 'AS e(parent_table, key_name, key_cols)');

const fkTuples = parseFkTuples(fkBody);
const postTuples = parsePostTuples(postBody);
const colShapeTuples = parseColShapeTuples(colShapeBody);
const uniqueKeyTuples = parseUniqueKeyTuples(uniqueKeyBody);

/** canonical TEST（nmwhwngojosmagjuvxol）2026-09-13 實查到的目標形狀。 */
const TARGET = [
  {
    parent: 'trips',
    childCols: ['tenant_id', 'trip_id'],
    parentCols: ['tenant_id', 'id'],
    deleteAction: 'RESTRICT',
    deltype: 'r',
    setNullCol: null as string | null,
  },
  {
    parent: 'trip_plans',
    childCols: ['tenant_id', 'trip_id', 'plan_id'],
    parentCols: ['tenant_id', 'trip_id', 'id'],
    deleteAction: 'RESTRICT',
    deltype: 'r',
    setNullCol: null,
  },
  {
    parent: 'trip_departures',
    childCols: ['tenant_id', 'trip_id', 'plan_id', 'departure_id'],
    parentCols: ['tenant_id', 'trip_id', 'plan_id', 'id'],
    deleteAction: 'RESTRICT',
    deltype: 'r',
    setNullCol: null,
  },
  {
    parent: 'customers',
    childCols: ['tenant_id', 'customer_id'],
    parentCols: ['tenant_id', 'id'],
    deleteAction: 'SET NULL (customer_id)',
    deltype: 'n',
    setNullCol: 'customer_id',
  },
] as const;

describe('#396 tour_orders 血統複合鍵', () => {
  it('施工 VALUES 區塊：四條父表，逐欄比對子鍵／父鍵／刪除語意（不是字串搜尋）', () => {
    expect(fkTuples, '施工區塊必須恰好四條').toHaveLength(4);
    for (const target of TARGET) {
      const tuple = fkTuples.find((t) => t.parent === target.parent);
      expect(tuple, `${target.parent} 沒被處理`).toBeDefined();
      expect(tuple!.childCols, `${target.parent} 的子鍵欄位組不對——不得退化成單欄`).toEqual(
        target.childCols,
      );
      expect(tuple!.parentCols, `${target.parent} 的父鍵欄位組不對`).toEqual(target.parentCols);
      expect(tuple!.deleteAction, `${target.parent} 的 delete 語意被改掉了`).toBe(target.deleteAction);
      expect(tuple!.deltype, `${target.parent} 的 deltype 與 delete 語意不一致`).toBe(target.deltype);
      if (target.setNullCol) {
        expect(tuple!.nullCol, `${target.parent} 的 SET NULL 欄位錯了`).toBe(target.setNullCol);
      }
    }
  });

  it('後置條件 VALUES 區塊：獨立解析，不得借用施工區塊的內容', () => {
    expect(postTuples, '後置條件必須恰好四條').toHaveLength(4);
    for (const target of TARGET) {
      const tuple = postTuples.find((t) => t.parent === target.parent);
      expect(tuple, `${target.parent} 沒有對應的後置條件`).toBeDefined();
      expect(tuple!.childCols, `${target.parent} 後置條件的子鍵欄位組不對`).toEqual(target.childCols);
      expect(tuple!.parentCols, `${target.parent} 後置條件的父鍵欄位組不對`).toEqual(target.parentCols);
      expect(tuple!.deltype, `${target.parent} 後置條件的 deltype 錯了`).toBe(target.deltype);
      expect(tuple!.expectSetNullCol, `${target.parent} 後置條件的 confdelsetcols 期待值錯了`).toBe(
        target.setNullCol,
      );
    }
  });

  it('customers 的 SET NULL 必須是 column-specific，且 confdelsetcols 斷言真的存在', () => {
    // 顧客那條是 column-specific SET NULL：只清 customer_id，不得把 tenant_id 也清成 null。
    expect(sql, 'SET NULL 未指定欄位會連 tenant_id 一起清掉').not.toMatch(
      /ON DELETE SET NULL(?!\s*\(|')/,
    );
    expect(sql).toContain('confdelsetcols');
    expect(sql, 'CONTINUE（已是目標形狀）分支必須驗證 confdelsetcols，不能對錯誤的 SET NULL 範圍沉默放行').toMatch(
      /IF spec\.parent_table = 'customers' AND[\s\S]{0,120}confdelsetcols/,
    );
    expect(sql).toContain('TOUR_ORDER_LINEAGE_CUSTOMER_SET_NULL_COLUMNS');
  });

  it('欄位形狀前置條件：四個子鍵欄位＋四組父鍵欄位全部是 uuid，且除了 customer_id 之外都 NOT NULL', () => {
    expect(colShapeTuples, '欄位形狀前置條件必須涵蓋 16 個欄位').toHaveLength(16);
    const expectNullable: Record<string, boolean> = { 'tour_orders.customer_id': true };
    for (const t of colShapeTuples) {
      const key = `${t.relName}.${t.colName}`;
      expect(t.nullableOk, `${key} 的可空性判定錯了`).toBe(expectNullable[key] ?? false);
    }
    const required = [
      'tour_orders.tenant_id', 'tour_orders.trip_id', 'tour_orders.plan_id',
      'tour_orders.departure_id', 'tour_orders.customer_id',
      'trips.tenant_id', 'trips.id',
      'trip_plans.tenant_id', 'trip_plans.trip_id', 'trip_plans.id',
      'trip_departures.tenant_id', 'trip_departures.trip_id', 'trip_departures.plan_id', 'trip_departures.id',
      'customers.tenant_id', 'customers.id',
    ];
    const present = new Set(colShapeTuples.map((t) => `${t.relName}.${t.colName}`));
    for (const key of required) expect(present.has(key), `缺少欄位形狀檢查：${key}`).toBe(true);
    expect(sql).toContain('TOUR_ORDER_LINEAGE_COLUMN_SHAPE');
    expect(sql).toContain('TOUR_ORDER_LINEAGE_MISSING_COLUMN');
  });

  it('補父表唯一鍵區塊仍是四支父表（trips/trip_plans/trip_departures/customers）', () => {
    expect(uniqueKeyTuples.map((t) => t.parentTable).sort()).toEqual(
      ['customers', 'trip_departures', 'trip_plans', 'trips'].sort(),
    );
  });

  it('鎖序是父表先、子表後——不得與 create_tour_order 的寫入順序相反', () => {
    const lockMatch = sql.match(/LOCK TABLE\s+([\s\S]*?)\s+IN SHARE ROW EXCLUSIVE MODE/);
    expect(lockMatch, '找不到 LOCK TABLE 語句').not.toBeNull();
    const lockedTables = lockMatch![1]
      .split(',')
      .map((s) => s.trim().replace(/^public\./, ''))
      .filter(Boolean);
    expect(lockedTables, '鎖序必須恰好涵蓋這五張表').toEqual(
      expect.arrayContaining(['trips', 'trip_plans', 'trip_departures', 'customers', 'tour_orders']),
    );
    expect(
      lockedTables.indexOf('tour_orders'),
      'tour_orders（子表）必須排在所有父表之後——create_tour_order 先寫 trip_departures 才 insert tour_orders，鎖序相反會互鎖',
    ).toBe(lockedTables.length - 1);
    expect(raw, '必須說明 cancel_tour_order 方向相反，父表先鎖不是萬用解').toContain('cancel_tour_order');
  });

  it('先查資料再改結構，且不得「修正」資料——鎖住精確的判斷式，不是只鎖住錯誤字串', () => {
    // 舊測試只查「TOUR_ORDER_LINEAGE_DATA_MISMATCH」這個字串存在，
    // `IF false THEN RAISE 'TOUR_ORDER_LINEAGE_DATA_MISMATCH'` 也會通過。
    // 這裡鎖住整個 IF EXISTS(...) 判斷式本身的骨架。
    expect(sql, '資料前置檢查的判斷式被架空了（例如換成 IF false）').toMatch(
      /IF EXISTS \(\s*SELECT 1 FROM public\.tour_orders o[\s\S]*?\) THEN\s*RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_DATA_MISMATCH'/,
    );
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

  it('先建強鍵並 VALIDATE，再拆弱鍵——不得留下空窗或雙鍵', () => {
    const add = sql.indexOf('ADD CONSTRAINT %I FOREIGN KEY');
    const validate = sql.indexOf('VALIDATE CONSTRAINT %I', add);
    const drop = sql.indexOf('DROP CONSTRAINT %I');
    expect(add, 'migration 沒有新增強鍵').toBeGreaterThan(-1);
    expect(validate, '新增的 NOT VALID 鍵沒有被 VALIDATE').toBeGreaterThan(add);
    expect(drop, '弱鍵沒有被拆掉——兩支並存會讓 PostgREST 關聯變歧義').toBeGreaterThan(validate);
  });

  it('已經是目標形狀時是 no-op（乾淨帳本重建與 canonical TEST 都會走這條）', () => {
    expect(sql, '缺少「已經是複合鍵就跳過」的分支＝在 TEST 上重跑會撞撞名').toContain('CONTINUE');
  });

  it('反向斷言：不得順手改動 RLS、角色權限或 tenant FK，且 FK 數量檢查是精確判斷式', () => {
    expect(sql).toContain('TOUR_ORDER_LINEAGE_RLS_CHANGED');
    expect(sql).toContain('TOUR_ORDER_LINEAGE_TENANT_FK_CHANGED');
    // 舊測試只查「TOUR_ORDER_LINEAGE_FK_COUNT」這個字串存在，
    // `IF false THEN RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_FK_COUNT...'` 也會通過。
    // 這裡鎖住 `IF fk_count <> 5` 這個精確判斷式本身。
    expect(sql, 'FK 數量檢查的判斷式被架空了（例如換成 IF false）').toMatch(
      /IF fk_count <> 5 THEN\s*\n\s*RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_FK_COUNT/,
    );
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
