import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createServerSupabase } from '@/server/supabase';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handle(async (req) => {
  const { email, password } = bodySchema.parse(await req.json());
  const supabase = await createServerSupabase();          // signIn 會把 session 寫進 cookie
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(401, '帳號或密碼錯誤', ERR.BAD_CREDENTIALS);
  return ok({ loggedIn: true });
});
