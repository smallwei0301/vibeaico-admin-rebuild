/**
 * 重複旅客的 DB 端共用查詢（Issue #45）：報表（/api/reports/guide）與訂單清單下鑽
 * （/api/tour-orders?repeatCustomers=1）都走這裡，保證兩邊的「重複旅客」是同一批人。
 * 口徑見 src/server/guide-report.ts 檔頭；集合運算是純函式 repeatCustomerIdSet。
 * 所有查詢明確帶 tenant_id、排除取消、customer_id 每批 200、keyset 分頁；任一批失敗就丟出（500）。
 */
import type { requireTenant } from '@/server/tenant';
import { ApiHttpError, ERR } from '@/server/http';
import { MAX_ROWS, repeatCustomerIdSet } from '@/server/guide-report';

type Db = Awaited<ReturnType<typeof requireTenant>>['supabase'];

export const ID_BATCH = 200;
const PAGE = 1000;

/** 單一批次最多查幾頁（每頁至少確認 1 位旅客，正常遠低於此）；超過就明確報錯，不回傳可能錯誤的集合。 */
export const MAX_PRIOR_PAGES_PER_BATCH = ID_BATCH + 5;

/**
 * 本期旅客中「beforeIso 之前已有非取消訂單」者。只需「是否存在」：每查到一批就把已確認的
 * customer_id 從待查清單移除，下一次只查剩下的人（不用 offset／游標），所以單一批次的頁數
 * 受限於旅客數、而不是他們的歷史訂單數。
 */
export async function fetchPriorCustomers(
  db: Db, tenantId: string, beforeIso: string, ids: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const remaining = new Set(ids.slice(i, i + ID_BATCH));
    for (let pages = 0; remaining.size > 0; pages += 1) {
      if (pages >= MAX_PRIOR_PAGES_PER_BATCH) throw new Error('重複旅客先前訂單查詢超過頁數上限');
      const { data, error } = await db.from('tour_orders').select('customer_id')
        .eq('tenant_id', tenantId).neq('status', 'CANCELLED')
        .lt('created_at', beforeIso).in('customer_id', [...remaining])
        .order('customer_id', { ascending: true }).limit(PAGE);
      if (error) throw error;
      const page = (data ?? []) as { customer_id: string | null }[];
      let found = 0;
      for (const x of page) {
        if (x.customer_id && remaining.delete(x.customer_id)) { out.add(x.customer_id); found += 1; }
      }
      if (page.length < PAGE || found === 0) break; // 短頁＝剩下的人確定沒有先前訂單
    }
  }
  return out;
}

/**
 * 訂單清單下鑽用：讀 [gteIso, ltIso) 內全部非取消訂單，回傳該區間的重複旅客 customer_id 集合。
 * 超過 MAX_ROWS 筆就拒絕（400），不回傳不完整的集合。
 */
export async function loadRepeatCustomerIds(
  db: Db, tenantId: string, gteIso: string, ltIso: string,
): Promise<Set<string>> {
  const rows: { status: string; customer_id: string | null }[] = [];
  let lastId: string | null = null;
  for (;;) {
    let q = db.from('tour_orders').select('id, status, customer_id')
      .eq('tenant_id', tenantId).neq('status', 'CANCELLED')
      .gte('created_at', gteIso).lt('created_at', ltIso);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) throw error;
    const page = (data ?? []) as { id: string; status: string; customer_id: string | null }[];
    rows.push(...page);
    if (rows.length > MAX_ROWS) throw new ApiHttpError(422, '區間內訂單過多，請縮短日期區間', ERR.REPORT_RANGE_TOO_LARGE);
    if (page.length < PAGE) break;
    lastId = page[page.length - 1].id;
  }
  const ids = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
  return repeatCustomerIdSet(rows, await fetchPriorCustomers(db, tenantId, gteIso, ids));
}
