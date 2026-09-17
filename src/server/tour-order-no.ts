/**
 * src/server/tour-order-no.ts — tour_orders.order_no 的配號邏輯（issue #46 Final Risk 修復）
 * -----------------------------------------------------------------------------
 * ## 修的是什麼「假成功」
 *
 * `POST /api/public/tour-requests`（旅客自助申請）與 `POST /api/tour-orders/manual`
 * （導遊手動建單）先前**各自內嵌**同一段配號邏輯：
 *
 *   ```
 *   .order('order_no', { ascending: false }).limit(1).maybeSingle()
 *   const serial = last ? Number(String(last.order_no).slice(-4)) + 1 : 1;
 *   const orderNo = `TO${yymmdd}${String(serial).padStart(4, '0')}`;
 *   ```
 *
 * 這是**字串排序**去找「今天最後一號」，隱含假設「流水號永遠是 4 位數」。當同一
 * 租戶、同一天累計超過 9999 筆時，第 10000 筆會被 `padStart(4,'0')` 輸出成 5 位數
 * `TO2609170010000`，而 PostgREST 的 `order('order_no', desc)` 是逐字元比較字串——
 * `'TO2609179999'` 在字典序上大於 `'TO26091710000'`（第 9 個字元 `9` > `1`），所以
 * 下一次查詢永遠還是抓到 `TO2609179999`、永遠重算出同一個已存在的 10000、永遠撞
 * `unique (tenant_id, order_no)`、3 次重試耗盡後變成 500——**當天剩下時間，這個
 * 租戶完全無法再建立任何一筆 tour order**，包含登入的導遊手動建單（因為兩支
 * route 共用同一個 `(tenant_id, order_no)` 命名空間）。
 *
 * 在 `POST /api/public/tour-requests` 出現之前，這條路徑只有登入的 tenant manager
 * 打得到，9999 筆／天不可能自己踩到。issue #46 讓它變成**匿名、無認證**可觸發，
 * 攻擊成本只是對單一租戶送出約一萬個 POST，因此升級為必須修的漏洞。
 *
 * ## 修法：不依賴字串排序，直接用數值比較找出今天真正的最大流水號
 *
 * 一次查出「今天、這個租戶」所有 `order_no`（不做 `limit(1)`），在應用層把每一筆
 * 的流水尾碼 parse 成數字取最大值——不管尾碼是 4 位數還是 5 位數、6 位數，數值
 * 比較永遠正確，不會被字串排序誤導。流水位寬只在輸出時 `padStart(4, '0')`，
 * `padStart` 從不截斷字串，超過 4 位數時原樣輸出（`10000` 就是 `10000`，不會被
 * 切成 4 碼），所以格式本身沒有位寬上限。
 *
 * 一天內的訂單量不會到需要分頁查詢的量級（這是單一租戶單一天的營運訂單，不是
 * 系統級的高頻表），一次抓全部换取「不會因為字串排序假設而永久卡死」，這個
 * 取捨是刻意的。
 */
/** 同 `src/server/tour-orders.ts` 的 `AnyClient`：這裡不需要完整的 supabase-js 型別。 */
type AnyClient = { from: (table: string) => any };

const ORDER_NO_PREFIX_LENGTH = 'TO'.length + 6; // 'TO' + yymmdd(6 碼)

/**
 * 算出「今天、這個租戶」下一個可用的 order_no。
 *
 * ⚠️ 呼叫端仍然要保留既有的「撞 unique 就重試」邏輯——這支函式只保證重算出來的
 * 候選號碼**在查詢當下是正確的最大值 + 1**，但兩個並行請求之間仍有 race window
 * （這裡沒有、也不需要資料庫端序列，因為 `create_tour_order` 本身的
 * `insert ... unique(tenant_id, order_no)` 已經是最後一道防線，撞號本來就會被
 * 資料庫擋下，交給呼叫端的重試迴圈處理——這支函式要修的是「重算出來的號碼是否
 * 正確」，不是「並行請求會不會撞號」，兩者是不同問題）。
 */
export async function nextTourOrderNo(
  supabase: AnyClient,
  tenantId: string,
  yymmdd: string,
): Promise<string> {
  const { data: rows, error } = await supabase
    .from('tour_orders')
    .select('order_no')
    .eq('tenant_id', tenantId)
    .like('order_no', `TO${yymmdd}%`);
  if (error) throw error;

  let maxSerial = 0;
  for (const row of rows ?? []) {
    const suffix = String(row.order_no ?? '').slice(ORDER_NO_PREFIX_LENGTH);
    const value = Number(suffix);
    if (Number.isFinite(value) && value > maxSerial) maxSerial = value;
  }

  const serial = maxSerial + 1;
  return `TO${yymmdd}${String(serial).padStart(4, '0')}`;
}
