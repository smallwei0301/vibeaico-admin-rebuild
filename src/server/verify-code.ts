/**
 * src/server/verify-code.ts — 共用驗碼函式
 * 規格：docs/integration/03-AUTH.md §2「共用驗碼函式」。
 */

import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export async function consumeCode(email: string, code: string, purpose: 'REGISTER' | 'RESET_PASSWORD') {
  const admin = createAdminSupabase();
  const { data } = await admin.from('auth_verification_codes').select('*')
    .eq('email', email).eq('purpose', purpose).eq('code', code)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new ApiHttpError(400, '驗證碼錯誤或已過期', ERR.CODE_INVALID);
  await admin.from('auth_verification_codes')
    .update({ consumed_at: new Date().toISOString() }).eq('id', data.id);
}
