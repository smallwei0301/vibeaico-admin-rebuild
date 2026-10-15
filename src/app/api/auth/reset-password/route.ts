import { z } from 'zod';
import { readJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES, handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { findValidCode, markCodeConsumed } from '@/server/verify-code';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

const MSG_CODE_INVALID = '驗證碼錯誤或已過期';
const MSG_WEAK_PASSWORD = '新密碼不符合安全規則，請換一組更長或更複雜的密碼';
const MSG_SAME_PASSWORD = '新密碼不可與目前密碼相同，請換一組新的密碼';
const MSG_RESET_FAILED = '密碼重設失敗，請稍後再試';

/** 只認 Supabase Auth 文件化的 error.code；5xx／未知一律視為系統失敗。 */
function updateFailure(error: { code?: string; status?: number }) {
  if (error.code === 'weak_password') return fail(400, MSG_WEAK_PASSWORD, ERR.VALIDATION);
  if (error.code === 'same_password') return fail(400, MSG_SAME_PASSWORD, ERR.VALIDATION);
  if (error.code === 'user_not_found') return fail(400, MSG_CODE_INVALID, ERR.CODE_INVALID);
  console.error('[reset-password] updateUserById failed', error.code, error.status);
  return fail(500, MSG_RESET_FAILED, ERR.INTERNAL);
}

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await readJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES));
  // 先驗證、不消耗：密碼更新失敗時驗證碼必須保留，讓使用者可重試。
  const codeId = await findValidCode(b.email, b.code, 'RESET_PASSWORD');
  const admin = createAdminSupabase();
  const { data: uid, error: rpcError } = await admin.rpc('user_id_by_email', { p_email: b.email });
  if (rpcError) throw rpcError; // 查詢失敗是系統錯誤（handle() → 500），不是驗證碼錯誤
  if (!uid) return fail(400, MSG_CODE_INVALID, ERR.CODE_INVALID);
  const { error: updateError } = await admin.auth.admin.updateUserById(uid, { password: b.newPassword });
  if (updateError) return updateFailure(updateError);
  // 只有密碼確實更新成功後才消耗驗證碼（條件式，防並發重用）。
  // 密碼此時已改成功：消耗失敗（DB error／並發已消耗）不得讓使用者看到失敗，只記 log（不含 email／密碼／驗證碼）。
  try {
    await markCodeConsumed(codeId);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('[reset-password] markCodeConsumed failed after password reset', err?.code, err?.message);
  }
  return ok({ reset: true });
});
