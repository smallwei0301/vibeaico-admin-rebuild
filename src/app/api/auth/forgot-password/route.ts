import { z } from 'zod';
import { handle, ok, ApiHttpError } from '@/server/http';
import { dispatchVerificationCode } from '@/server/send-code';

const bodySchema = z.object({ email: z.string().email() });

// 03 分冊 §4 尾：「forgot-password route 只是 send-verification-code 的殼：
// 固定 purpose = 'RESET_PASSWORD'，一律回 ok({ sent: true })」。
// dispatchVerificationCode() 命中 60 秒節流時會丟 ApiHttpError(429, …)——
// 依規格「一律」的要求在這裡吞掉，不讓節流狀態外洩給呼叫端（送出重設密碼信
// 也是防列舉手法的一部分：不論帳號是否存在、是否剛寄過，介面反應都相同）。
export const POST = handle(async (req) => {
  const { email } = bodySchema.parse(await req.json());
  try {
    await dispatchVerificationCode(email, 'RESET_PASSWORD');
  } catch (e) {
    // 只吞 429 節流；寄信服務異常（503，#754）必須讓使用者知道，不得假裝已寄出。
    if (!(e instanceof ApiHttpError) || e.status !== 429) throw e;
  }
  return ok({ sent: true });
});
