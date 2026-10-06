import { z } from 'zod';
import { handle, ok, fail, ERR, readJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES } from '@/server/http';
import { requireUser } from '@/server/tenant';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await readJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES));
  const { supabase, user } = await requireUser();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email!, password: b.currentPassword,
  });
  if (error) return fail(400, '目前密碼不正確', ERR.BAD_CREDENTIALS);
  await supabase.auth.updateUser({ password: b.newPassword });
  return ok({ changed: true });
});
