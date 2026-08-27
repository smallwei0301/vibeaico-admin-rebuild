import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { parseAtomicTripImport } from '@/server/trip-import';

/**
 * POST /api/trips/import — 匯入 tour-platform 匯出的行程 JSON ⚙M。
 *
 * 使用者需求原文：「tour platform 的管理者 json 文件也可以到這裡傳上去，
 * 直接是之前整理好的行程和方案，不會遺漏。」
 *
 * 行為與 tour-platform 匯入端一致的兩點：
 *   1. `_instructions` 是欄位說明區塊，忽略不寫入。
 *   2. 方案「只新增不覆蓋」——重跑同一份檔案不會把使用者後來在後台改過的
 *      方案內容蓋掉（以 slug 比對既有方案；tour-platform 匯入說明第 4 點同此）。
 *
 * 行程本身則以 slug 判斷新增或更新：同 slug 視為同一個行程的新版本內容。
 * 這讓「在 tour-platform 改完再匯一次」是可預期的更新，而不是每次都長出新行程。
 * 儲存時 RPC 會以 slug 排序取得鎖，避免重疊批次互鎖；回傳的 results 仍維持
 * 呼叫端原本的輸入順序。
 *
 * 接受單筆物件或陣列（tour-platform 一次匯出一個行程，但管理者可能自行合併多個）。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const raw = await req.json();
  const trips = parseAtomicTripImport(raw, t.tenantId);
  // Exactly one database call: the SECURITY INVOKER RPC owns the transaction.
  const { data, error } = await t.supabase.rpc('import_trips_atomic', {
    p_tenant_id: t.tenantId,
    p_trips: trips,
  });
  if (error) {
    // The RPC owns all database-side structural/limit validation.  PostgREST
    // returns PostgreSQL invalid-parameter errors as 22023; expose those as
    // the normal request-validation contract instead of an opaque 500.
    if (error.code === '22023') throw new ApiHttpError(400, error.message, ERR.VALIDATION);
    throw error;
  }
  const results = (data ?? []).map((row: any) => ({
    title: row.title,
    tripId: row.trip_id,
    created: row.created,
    plansAdded: row.plans_added,
  }));
  return ok({ imported: results.length, results });
});
