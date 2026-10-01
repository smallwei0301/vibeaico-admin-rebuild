import { handle, ok, fail, ERR } from '@/server/http';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import { loadPublicTripDetails } from '@/server/public-shop';
import { publicCorsHeaders, publicCorsPreflightResponse } from '@/server/public-cors';

/**
 * GET /api/public/shops/{shopCode}/trips/{slug} — 單一已發布行程詳情（issue #11）。
 * 資料只能來自現有公開白名單 loader；名額只在本次請求讀取，建立訂單時仍由後端重查。
 */
export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

type Params = { params: Promise<{ shopCode: string; slug: string }> };

export const GET = handle(async (req, { params }: Params) => {
  const { shopCode, slug } = await params;
  const corsHeaders = publicCorsHeaders(req.headers.get('origin'));
  const ip = clientIpFromHeaders(req.headers);
  const rateLimitKey = `public-trip-detail:${ip}:${shopCode}`;
  if (!checkRateLimit(rateLimitKey, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS })) {
    const res = fail(429, '請求過於頻繁，請稍後再試', ERR.RATE_LIMITED);
    for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
    return res;
  }

  const data = await loadPublicTripDetails(shopCode, slug);
  if (!data) {
    const res = fail(404, '找不到這個行程', ERR.NOT_FOUND);
    for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
    return res;
  }

  const res = ok(data);
  for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
  return res;
});

export function OPTIONS(req: Request) {
  return publicCorsPreflightResponse(req.headers.get('origin'));
}
