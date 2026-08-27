// tests/helpers/line-webhook.ts
//
// 等待 webhook 的背景事件處理跑完（issue #31）。
//
// 背景：`src/app/api/line/webhook/[shopCode]/route.ts` 驗簽後**立刻回 200**，
// 事件處理搬到 Next 的 `after()` 裡跑（06 分冊 §3.1）。所以「webhook 回了 200」
// 之後，reply 還沒送到 mock LINE、chat_messages 也可能還沒寫——舊測試那種
// 「拿到 200 就馬上斷言」在改動後會變成一場賽跑。
//
// ⚠️ **不要用 sleep 湊**（12 分冊 §2.3 明文禁用 sleep 等待）。`await sleep(500)`
// 之後斷言的測試有兩種壞法，而且都很難查：
//   - 正向斷言（「reply 該送出」）→ 機器慢一點就偶發紅燈；
//   - 反向斷言（「不該有 reply」）→ 背景工作只是還沒跑到，測試照樣綠，
//     等於什麼都沒驗到。
//
// 這裡用的是**確定性的完成訊號**：route 在回 200 之前就把該次請求的處理
// promise 登記進模組內的 pending set，`GET` 同一個路徑（僅 NODE_ENV!=production
// 時開放，正式部署維持 405）會 await 掉所有還沒跑完的處理才回應。
// 所以 `await postWebhook(...)` → `await drainWebhook(...)` 回來時，
// 「該次請求的事件處理已經結束」是**被 server 保證**的，不是猜的時間。

const DEFAULT_BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/**
 * 等到該路由所有 after() 事件處理跑完。
 * 回傳 {
 *   drained:   這次**實際 await 掉**幾筆還在跑的處理（會因為工作跑太快而是 0，
 *              所以不要拿它當「有沒有排入工作」的證據）；
 *   scheduled: 這個 route 從啟動到現在**累計排入過**幾筆背景處理（單調遞增，
 *              不受完成時機影響——「驗簽失敗不得排入任何工作」就是靠它斷言）；
 *   errors:    route 吞掉並記錄的錯誤（最近 20 筆）。
 * }
 *
 * 呼叫時機：`await postWebhook(...)` 拿到回應之後（登記發生在回應之前，
 * 所以不會有「還沒登記就先排空」的空窗）。
 *
 * `errors` 的用途：webhook 對 LINE 永遠回 200，處理失敗只留 log——但
 * `console.error` 是印到 next dev 的 stdout（global-setup 用 stdio:'inherit'），
 * 測試 process 攔不到。route 在**非正式環境**額外把同一筆錯誤留一份在記憶體，
 * 讓「錯誤有被記錄」這件事可以真的被斷言，而不是靠人相信。
 */
export async function drainWebhook(
  shopCode: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<{ drained: number; scheduled: number; errors: string[] }> {
  const res = await fetch(`${baseUrl}/api/line/webhook/${shopCode}`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `drainWebhook: GET /api/line/webhook/${shopCode} 回 ${res.status}` +
        '（僅 NODE_ENV!=production 開放；整合測試的 next dev 應為 development）',
    );
  }
  const body = (await res.json()) as { drained?: number; scheduled?: number; errors?: string[] };
  return { drained: body.drained ?? 0, scheduled: body.scheduled ?? 0, errors: body.errors ?? [] };
}
