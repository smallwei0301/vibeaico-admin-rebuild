/**
 * src/server/public-cors.ts — `/api/public/**` 的跨網域授權（issue #11 §4.1）
 * -----------------------------------------------------------------------------
 * `docs/integration/11-PARTNER-API.md` §4.1 的要求：
 *   「`/api/public/**` 回應 `Access-Control-Allow-Origin` 白名單（Midao 正式／
 *    預覽網域，env `PUBLIC_CORS_ORIGINS` 逗號分隔）+ `OPTIONS` preflight。」
 *
 * 這是全站第一個刻意允許跨網域呼叫的路徑（其餘 API 本來就不需要 CORS——後台
 * 只有同網域的頁面會呼叫）。三條規則，每一條都不是形式：
 *
 * 1. **精確比對 origin 字串，不接受萬用字元。** `PUBLIC_CORS_ORIGINS` 是逗號分隔
 *    的完整網域清單；不支援 `*.vercel.app` 這種樣式比對——那會讓任何人申請一個
 *    子網域就能繞過白名單。
 * 2. **未在白名單的 origin，一律不回 `Access-Control-Allow-Origin`。** 不是回一個
 *    「拒絕」的 CORS header，是完全不設定這個 header——瀏覽器看不到 ACAO 就會
 *    擋下跨網域讀取，這才是 CORS 真正的拒絕方式。
 * 3. **env 沒設定時 fail closed。** `PUBLIC_CORS_ORIGINS` 未設定＝允許清單是空的，
 *    不是「允許全部」也不是「跳過檢查」。同源請求（瀏覽器不會帶 `Origin` header，
 *    或 `Origin`等於本站網域）不受影響，仍然正常運作。
 */
import { serverEnv } from '@/config/env';

function allowedOrigins(): Set<string> {
  return new Set(
    (serverEnv.PUBLIC_CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

/**
 * 依請求的 `Origin` header 算出這次回應要不要帶、帶哪些 CORS header。
 *
 * `Vary: Origin` 一律加：即使這次沒有放行，也要讓快取層知道「這個回應依 Origin
 * 而不同」，避免 CDN／瀏覽器把「允許 A 網域」的回應快取起來，錯誤地也給 B 網域用。
 */
export function publicCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (!requestOrigin) return headers;
  if (allowedOrigins().has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  return headers;
}

/**
 * `OPTIONS` preflight 回應。只回放行所需的最小 header 組合；不放行的 origin
 * 一樣拿到 204，但沒有 `Access-Control-Allow-Origin`，瀏覽器仍會擋下正式請求。
 */
export function publicCorsPreflightResponse(requestOrigin: string | null): Response {
  const headers = publicCorsHeaders(requestOrigin);
  if (headers['Access-Control-Allow-Origin']) {
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(null, { status: 204, headers });
}
