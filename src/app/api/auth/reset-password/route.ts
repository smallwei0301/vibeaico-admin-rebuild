import { z } from 'zod';
import { readJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES, handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { findValidCode, claimCode, releaseClaim } from '@/server/verify-code';
import { assertCodeAttemptsAllowed } from '@/server/verify-code-throttle';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

const MSG_CODE_INVALID = '驗證碼錯誤或已過期';
const MSG_WEAK_PASSWORD = '新密碼不符合安全規則，請換一組更長或更複雜的密碼';
const MSG_SAME_PASSWORD = '新密碼不可與目前密碼相同，請重新申請驗證碼後換一組新的密碼';
const MSG_RESET_FAILED = '密碼重設失敗，請稍後再試';

/** 只認 Supabase Auth 文件化的 error.code；5xx／未知一律視為系統失敗。可重試失敗釋放占用。 */
async function updateFailure(error: { code?: string; status?: number }, codeId: string, claimTs: string) {
  if (error.code === 'same_password') {
    // 不釋放：驗證碼維持已消耗，避免持碼者在有效期內反覆探測「候選密碼是否等於目前密碼」。
    return fail(400, MSG_SAME_PASSWORD, ERR.VALIDATION);
  }
  // 其餘皆為可重試失敗：釋放占用，讓使用者在有效期內修正後重試。
  await releaseClaim(codeId, claimTs);
  if (error.code === 'weak_password') return fail(400, MSG_WEAK_PASSWORD, ERR.VALIDATION);
  if (error.code === 'user_not_found') return fail(400, MSG_CODE_INVALID, ERR.CODE_INVALID);
  console.error('[reset-password] updateUserById failed', error.code, error.status);
  return fail(500, MSG_RESET_FAILED, ERR.INTERNAL);
}

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await readJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES));
  // 先驗證（無碼一律在此 400，維持列舉安全）。
  // #1030：驗證前先檢查失敗額度（即使碼正確，額度已滿也先擋）；碼無效才記一次失敗。
  const attempt = assertCodeAttemptsAllowed(req.headers, b.email, 'RESET_PASSWORD'); // 同步預約額度
  let codeId: string;
  try {
    codeId = await findValidCode(b.email, b.code, 'RESET_PASSWORD');
    attempt.settle(); // 碼有效：退還預約
  } catch (e) {
    attempt.settle(e); // CODE_INVALID 保留計數；其他錯誤退還
    throw e;
  }
  const admin = createAdminSupabase();
  const { data: uid, error: rpcError } = await admin.rpc('user_id_by_email', { p_email: b.email });
  if (rpcError) throw rpcError; // 查詢失敗是系統錯誤（handle() → 500）；尚未占用，無需釋放
  if (!uid) return fail(400, MSG_CODE_INVALID, ERR.CODE_INVALID);
  // 原子占用：並發敗方 0 列 → 400 CODE_INVALID，不會走到 updateUserById。
  const claimTs = await claimCode(codeId);
  const { error: updateError } = await admin.auth.admin.updateUserById(uid, { password: b.newPassword });
  if (updateError) return await updateFailure(updateError, codeId, claimTs);
  return ok({ reset: true });
});
