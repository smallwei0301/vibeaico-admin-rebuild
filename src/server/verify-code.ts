/**
 * src/server/verify-code.ts — 共用驗碼函式
 * 規格：docs/integration/03-AUTH.md §2「共用驗碼函式」。
 *
 * `consumeCode` = `findValidCode`（只驗證、不消耗）＋ `claimCode`（條件單列消耗）。
 * 重設密碼（#1028）採「先原子占用、再改密碼、可重試失敗才釋放」：
 * `findValidCode` → `claimCode` → 動作 →（可重試失敗）`releaseClaim`。
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
 * 原子占用：只在 consumed_at 仍為 null 時以 claimTs 更新，且必須確實更新到一列
 * （並發重用時敗方更新到 0 列 → 400 CODE_INVALID）。回傳 claimTs，供 releaseClaim 比對。
 */
export async function claimCode(id: string): Promise<string> {
  const admin = createAdminSupabase();
  const claimTs = new Date().toISOString();
  const { data, error } = await admin.from('auth_verification_codes')
    .update({ consumed_at: claimTs })
    .eq('id', id).is('consumed_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length !== 1) throw codeInvalid();
  return claimTs;
}

/**
 * 釋放占用（僅限可重試失敗）：只有 consumed_at 仍等於自己的 claimTs 才還原為 null。
 * 失敗只記 log、不丟錯（fail-closed：碼維持已消耗，使用者需重新申請）。
 */
export async function releaseClaim(id: string, claimTs: string): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.from('auth_verification_codes')
      .update({ consumed_at: null })
      .eq('id', id).eq('consumed_at', claimTs);
    if (error) console.error('[verify-code] releaseClaim failed', error.code, error.message);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('[verify-code] releaseClaim failed', err?.code, err?.message);
  }
}

export async function consumeCode(email: string, code: string, purpose: CodePurpose) {
  const id = await findValidCode(email, code, purpose);
  await claimCode(id);
}
