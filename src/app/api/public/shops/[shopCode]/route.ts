import { handle, ok, fail, ERR } from '@/server/http';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import { loadPublicShop } from '@/server/public-shop';
import { publicCorsHeaders, publicCorsPreflightResponse } from '@/server/public-cors';

/**
 * GET /api/public/shops/{shopCode} — 店家公開資料（issue #11 §2，`docs/integration/
 * 11-PARTNER-API.md`）。
 *
 * 全站第三支匿名可打的公開端點（前兩支是 `POST /api/public/tour-requests` 與
 * `mine`），也是第一支**允許跨網域呼叫**的（見 `src/server/public-cors.ts`）——
 * 未來 Midao 前台會直接呼叫這支取得行程與服務目錄。
 *
 * 資料完全重用 `src/server/public-shop.ts` 早已驗證過的白名單 loader；本檔只是
 * 把它包成 HTTP API，不另外重寫一套查詢或白名單規則（`loadPublicShop()` 檔頭的
 * 三條安全規則同樣適用於這裡）。`tenantId` 是內部埋點用欄位，不在公開白名單上，
 * 這裡刻意不回傳。
 *
 * ⚠️ 這是 `docs/integration/11-PARTNER-API.md` §2 那張端點表格的第一支，範圍刻意
 * 只做「店家公開資料 + 行程 + 服務」這個組合（等同 `/s/{shopCode}` Server Component
 * 目前讀到的內容），不是把表格六支端點一次全做——`/catalog`、單一行程詳情
 * `/trips/{slug}`、即時餘額 `/departures/{id}/availability`、評論等留給後續切片，
 * 各自有自己的形狀與快取考量，不應該為了「一次做完」而在這裡臆造尚未設計好的
 * 回應格式。
 */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const GET = handle(async (req, { params }: { params: Promise<{ shopCode: string }> }) => {
  const { shopCode } = await params;
  const origin = req.headers.get('origin');
  const corsHeaders = publicCorsHeaders(origin);

  const ip = clientIpFromHeaders(req.headers);
  const rateLimitKey = `public-shop:${ip}:${shopCode}`;
  if (!checkRateLimit(rateLimitKey, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return fail(429, '請求過於頻繁，請稍後再試', ERR.RATE_LIMITED);
  }

  const data = await loadPublicShop(shopCode);
  if (!data) {
    const res = fail(404, '找不到這家店', ERR.NOT_FOUND);
    for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
    return res;
  }

  // `tenantId` 是內部埋點用欄位，刻意不在公開回應裡。
  const { tenantId: _tenantId, ...publicData } = data;
  const res = ok(publicData);
  for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
  return res;
});

export function OPTIONS(req: Request) {
  return publicCorsPreflightResponse(req.headers.get('origin'));
}
