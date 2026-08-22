import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { dispatchVerificationCode } from '@/server/send-code';

const bodySchema = z.object({
  email: z.string().email('請輸入有效的 Email'),
  purpose: z.enum(['REGISTER', 'RESET_PASSWORD']),
});

// ⚠️ 偏離 03 分冊 §2 原文：原文把節流檢查／email 是否已存在的枚舉防護／產碼／
// 寫入／寄信整段邏輯直接寫在這支 route 裡，其中還有一行死碼
// `const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 } as any);`
// ——取回的 users 從未被使用（真正的存在性判斷是 email_exists rpc），
// tsconfig strict（noUnusedLocals 家族）下未使用的區域變數會編譯失敗，故不轉錄
// 這一行。核心邏輯抽到 `@/server/send-code`（見該檔頂端註解），forgot-password
// route 也呼叫同一函式，避免兩處複製貼上；行為與規格原文相同。
export const POST = handle(async (req) => {
  const { email, purpose } = bodySchema.parse(await req.json());
  await dispatchVerificationCode(email, purpose);
  return ok({ sent: true });
});
