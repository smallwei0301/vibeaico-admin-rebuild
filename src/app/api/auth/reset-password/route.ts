import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { consumeCode } from '@/server/verify-code';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  await consumeCode(b.email, b.code, 'RESET_PASSWORD');
  const admin = createAdminSupabase();
  const { data: uid } = await admin.rpc('user_id_by_email', { p_email: b.email });
  if (!uid) return fail(400, '驗證碼錯誤或已過期', ERR.CODE_INVALID);
  await admin.auth.admin.updateUserById(uid, { password: b.newPassword });
  return ok({ reset: true });
});
