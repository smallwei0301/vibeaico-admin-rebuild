import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { loadSupportAnswer } from '@/server/support-chat';
import { APP_URL } from '@/config/env';

/**
 * POST /api/support-chat/ask — 後台右下角小幫手的唯一端點。
 *
 * ⚠️ 路徑刻意**不是** `/api/support-chat/messages`：那個名字在 04 分冊 §B-6 與
 * issue #25 已經被「客服對話串（寫進 support_chat_* 表、寄信給平台管理者）」佔用。
 * 這一版沒有建那兩張表，也沒有寄信；用同一個路徑會讓日後真的做 #25 時，端點的
 * 語意悄悄從「送出一則客服訊息」變成「查一個自助狀態」，而契約文件不會提醒任何人。
 *
 * 這裡只讀不寫，所以 `STAFF` 就能用——查自己店的 LINE 狀態與推播額度不需要
 * MANAGER，把它擋掉只會讓第一線的人問不到最該問的那三件事。
 */
const bodySchema = z.object({
  question: z.string().trim().min(1, '請輸入問題').max(500, '問題請不要超過 500 字'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const { question } = bodySchema.parse(await req.json());
  const answer = await loadSupportAnswer(
    t.supabase,
    { tenantId: t.tenantId, shopCode: t.shopCode, appUrl: APP_URL },
    question,
  );
  return ok(answer);
});
