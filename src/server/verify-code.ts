/**
 * src/server/verify-code.ts — 共用驗碼函式
 * 規格：docs/integration/03-AUTH.md §2「共用驗碼函式」。
 *
 * `consumeCode` = `findValidCode`（只驗證、不消耗）＋ `markCodeConsumed`（條件式消耗）。
 * 需要「後續動作成功才消耗」的流程（例如重設密碼，#1028）請分開呼叫這兩者。
 */

import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

type CodePurpose = 'REGISTER' | 'RESET_PASSWORD';

const CODE_INVALID_MESSAGE = '驗證碼錯誤或已過期';

function codeInvalid() {
  return new ApiHttpError(400, CODE_INVALID_MESSAGE, ERR.CODE_INVALID);
}

/** 找出一筆有效（未消耗、未過期）的驗證碼，回傳其 id；不消耗。無效丟 400 CODE_INVALID。 */
export async function findValidCode(email: string, code: string, purpose: CodePurpose): Promise<string> {
  const admin = createAdminSupabase();
  const { data } = await admin.from('auth_verification_codes').select('*')
    .eq('email', email).eq('purpose', purpose).eq('code', code)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) throw codeInvalid();
  return data.id as string;
}

/**
 * 條件式消耗：只在 consumed_at 仍為 null 時更新，且必須確實更新到一列
 * （並發重用時敗方更新到 0 列 → 400 CODE_INVALID）。
 */
export async function markCodeConsumed(id: string): Promise<void> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('auth_verification_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', id).is('consumed_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw codeInvalid();
}

export async function consumeCode(email: string, code: string, purpose: CodePurpose) {
  const id = await findValidCode(email, code, purpose);
  await markCodeConsumed(id);
}
