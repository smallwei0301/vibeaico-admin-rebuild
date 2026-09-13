import { handle, ok } from '@/server/http';
import { serverEnv } from '@/config/env';
import type { OAuthStatus } from '@/lib/types';

/**
 * GET /api/auth/oauth/status —— 公開端點，不需登入。
 *
 * Issue #26 slice 1：登入頁的 LINE／Google 按鈕在平台尚未設定 OAuth 憑證前
 * 不得連到不存在的 authorize 端點（見 docs/DELIVERY-CHAIN.md §5「誠實復原」）。
 * 這裡只回報「有沒有設定」的布林值，讓前端據此顯示真實的設定狀態，
 * 絕對不回傳 client id / secret 本身。
 *
 * 「設定完成」定義為 id 與 secret 兩者皆為非空字串——這與
 * src/config/env.ts 對這四個欄位維持 optional 的理由一致：骨架/TEST 環境
 * 通常兩者都沒設，此時 configured 應為 false。
 */
export const GET = handle(async () => {
  const google = Boolean(serverEnv.GOOGLE_OAUTH_CLIENT_ID) && Boolean(serverEnv.GOOGLE_OAUTH_CLIENT_SECRET);
  const line = Boolean(serverEnv.LINE_LOGIN_CHANNEL_ID) && Boolean(serverEnv.LINE_LOGIN_CHANNEL_SECRET);
  const status: OAuthStatus = { google: { configured: google }, line: { configured: line } };
  return ok(status);
});
