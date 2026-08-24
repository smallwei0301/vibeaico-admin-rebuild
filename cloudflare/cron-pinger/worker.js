/**
 * vibeai-cron-pinger — 獨立於主網站的迷你 Cloudflare Worker。
 *
 * 唯一工作：每小時打一次 Vercel 上的 /api/cron/booking-reminders，
 * 補足 Vercel Hobby 方案「cron 只能一天一次」的限制（vercel.json 那份仍
 * 保留每天一次當備援；這支 Worker 讓提醒維持接近原本設計的「每小時」節奏）。
 *
 * 不碰資料庫、不碰其他任何服務——就是一支會定時打電話的鬧鐘。
 *
 * 部署方式見同資料夾 README.md。
 */

async function pingBookingReminders(env) {
  const url = `${env.TARGET_BASE_URL}/api/cron/booking-reminders`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await res.text();
  console.log(`[cron-pinger] ${url} -> ${res.status} ${body.slice(0, 300)}`);
  if (!res.ok) {
    // 讓失敗在 Cloudflare 的 cron 執行紀錄裡看得到（Workers & Pages → 該
    // Worker → Logs），不需要額外告警系統。
    throw new Error(`booking-reminders 回應非 2xx：${res.status}`);
  }
  return { status: res.status, body };
}

export default {
  // Cron Trigger 排程到時間就會呼叫這裡（見 wrangler.toml 的 [triggers]）。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingBookingReminders(env));
  },

  // 額外開一個 HTTP 入口方便手動測試（不用等下一個整點）。用一個簡單的
  // query 參數擋掉隨便亂打的公開請求——這不是安全機制的全部，真正的防線
  // 還是下游 API 自己驗 CRON_SECRET；這裡只是避免 Worker 自己的 fetch
  // 配額被陌生請求浪費。
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    try {
      const result = await pingBookingReminders(env);
      return Response.json(result);
    } catch (e) {
      return new Response(String(e), { status: 502 });
    }
  },
};
