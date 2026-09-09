import { handle, ok } from '@/server/http';
import { requireUser } from '@/server/tenant';
import { cookies } from 'next/headers';
import { IMPERSONATION_COOKIE, endImpersonation } from '@/server/platform-admin';

/**
 * POST /api/platform/impersonation/end —— 結束代入。
 *
 * 刻意**不**要求仍是 platform admin：權限已被撤銷的人也必須能把自己踢出來，
 * 而且 cookie 一定要清得掉。`endImpersonation()` 以 `admin_user_id` 收窄，
 * 所以別人的 session 動不了。沒有代入中也回 200（冪等）。
 */
export const POST = handle(async () => {
  const { user } = await requireUser();
  const jar = await cookies();
  const sessionId = jar.get(IMPERSONATION_COOKIE)?.value;
  if (sessionId) await endImpersonation(sessionId, user.id);
  jar.set(IMPERSONATION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return ok({ ended: true });
});
