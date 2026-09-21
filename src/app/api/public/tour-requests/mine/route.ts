import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { checkRateLimit, clientIpFromHeaders } from '@/server/rate-limit';
import { loadPublicTourOrdersByContact } from '@/server/public-tour-request';

/**
 * POST /api/public/tour-requests/mine — 旅客「我的訂單」查詢（issue #46 第三片）。
 *
 * 全站第二支匿名可打的公開端點（第一支是 `POST /api/public/tour-requests` 送出
 * 申請）；這支是**讀**，但同樣不需要登入，一樣套用 F1 的固定視窗節流——理由
 * 相同：沒有節流，攻擊者可以拿常見電話／Email 字典對單一店家窮舉，即使查不到
 * 內容也會把資料庫打爆。
 *
 * 找不到符合的訂單、shopCode 不存在、或旅遊模組未啟用，一律回傳空陣列（見
 * `loadPublicTourOrdersByContact` 檔頭），不用 404／403 洩漏「這個 shopCode
 * 到底存不存在」。
 */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const bodySchema = z.object({
  shopCode: z.string().trim().min(1).max(64),
  contact: z.string().trim().min(1, '請輸入查詢用的聯絡方式').max(254),
});

export const POST = handle(async (req) => {
  const body = bodySchema.parse(await req.json());

  const ip = clientIpFromHeaders(req.headers);
  const rateLimitKey = `mine:${ip}:${body.shopCode}`;
  if (!checkRateLimit(rateLimitKey, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return fail(429, '請求過於頻繁，請稍後再試', ERR.RATE_LIMITED);
  }

  const orders = await loadPublicTourOrdersByContact(body.shopCode, body.contact);
  return ok({ orders });
});
