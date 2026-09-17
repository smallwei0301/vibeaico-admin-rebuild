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
 * ## 修法（F1 首版）：不依賴字串排序，直接用數值比較找出今天真正的最大流水號
 *
 * 查出「今天、這個租戶」所有 `order_no`，在應用層把每一筆的流水尾碼 parse 成數字
 * 取最大值——不管尾碼是 4 位數還是 5 位數、6 位數，數值比較永遠正確，不會被字串
 * 排序誤導。流水位寬只在輸出時 `padStart(4, '0')`，`padStart` 從不截斷字串，超過
 * 4 位數時原樣輸出（`10000` 就是 `10000`，不會被切成 4 碼），所以格式本身沒有位
 * 寬上限。
 *
 * ## F1 首版留下的新洞：PostgREST `max_rows` 截斷（Final Risk 對抗審查再次抓到）
 *
 * 上面那版查詢**沒有 `.range()` / `.limit()` / `.order()`**，隱含假設「一次查詢
 * 會拿到今天這個租戶的全部列」。但 PostgREST 對每一次查詢都有硬性 `max_rows`
 * 上限（`supabase/config.toml` 的 `api.max_rows = 1000`；Supabase 平台預設同樣是
 * 1000），超過上限時**不會報錯**，只會靜默只回一個 `max_rows` 大小、順序不保證
 * 的子集。單一租戶單日訂單一旦超過 1000 筆，`rows` 就不再是「今天全部訂單」，
 * 用它算出來的 `maxSerial` 可能比真正的最大值小，重算出的候選號碼會撞上一筆
 * *已經存在*的 `order_no`，撞 `unique (tenant_id, order_no)`，3 次重試耗盡後
 * 變 500——這正是 F1 原本要修掉的「當天剩下時間整個租戶無法再建單」DoS，只是
 * 門檻從 9999 掉到 1000（惡化 10 倍），而且 `POST /api/public/tour-requests`
 * 是**匿名、無認證**端點，湊到 1000 筆比湊到 9999 筆便宜十倍。
 *
 * ## 修法（本次）：用 `.range()` 分頁掃完當天全部列，逐頁取數值最大值
 *
 * 不改變「在應用層用數值比較找最大值」這個已經證明正確的核心邏輯，只是不再假設
 * 一次查詢就能拿到全部資料：改成用 `.order('order_no', { ascending: true })` 搭配
 * `.range()` 逐頁掃描，直到某一頁回傳的筆數小於頁面大小（代表已經掃到最後一頁）
 * 為止。`order_no` 在 `tour_orders` 上有 `unique (tenant_id, order_no)`，同一租戶
 * 內不會重複，所以不管用哪一種穩定總排序做分頁基準，每一列都恰好會被掃到一次、
 * 不漏不重——分頁正確性不依賴 `order_no` 的字典序恰好等於數值序，只依賴它是
 * unique key（分頁遊標用它排序只是為了拿到穩定總排序，不是拿它的排序結果來算
 * 最大值，最大值仍然是逐列數值比較算出來的）。
 *
 * 頁面大小固定抓 PostgREST `max_rows` 常見值 1000：即使實際部署的 `max_rows`
 * 更大，這裡也只是多分幾頁，不影響正確性；即使更小，PostgREST 本來就會再把
 * 單頁請求截斷到它自己的上限，一樣不影響正確性（回傳的筆數會小於我方要求的
 * 頁面大小，迴圈照樣往下一頁走，只是分頁次數變多）。
 *
 * 這是 O(n) 次來回查詢（n = 當天訂單量 / 頁面大小），比一次查詢貴，但比「靜默
 * 算錯、永久卡死」正確——而且單一租戶單一天的訂單量本來就是業務量級，不是系統級
 * 高頻表，多幾次分頁查詢的成本可以接受。
 */
/** 同 `src/server/tour-orders.ts` 的 `AnyClient`：這裡不需要完整的 supabase-js 型別。 */
type AnyClient = { from: (table: string) => any };

const ORDER_NO_PREFIX_LENGTH = 'TO'.length + 6; // 'TO' + yymmdd(6 碼)

/**
 * 分頁頁面大小。刻意抓 PostgREST `max_rows` 的常見值（`supabase/config.toml`
 * 的 `api.max_rows = 1000`，Supabase 平台預設同樣是 1000）——正確性不依賴這個
 * 數字與實際部署的 `max_rows` 完全相等，見檔頭說明。
 */
const PAGE_SIZE = 1000;

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
  let maxSerial = 0;
  let offset = 0;

  for (;;) {
    const { data: rows, error } = await supabase
      .from('tour_orders')
      .select('order_no')
      .eq('tenant_id', tenantId)
      .like('order_no', `TO${yymmdd}%`)
      .order('order_no', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = rows ?? [];
    for (const row of batch) {
      const suffix = String(row.order_no ?? '').slice(ORDER_NO_PREFIX_LENGTH);
      const value = Number(suffix);
      if (Number.isFinite(value) && value > maxSerial) maxSerial = value;
    }

    // 回傳筆數小於頁面大小 = 已經掃到今天最後一頁（不管是因為真的沒資料了，
    // 還是被 PostgREST 自己的 max_rows 再截斷了一次，兩種情況都要繼續往下一頁
    // 走，只有「剛好回滿一整頁」才可能還有下一頁）。
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const serial = maxSerial + 1;
  return `TO${yymmdd}${String(serial).padStart(4, '0')}`;
}
