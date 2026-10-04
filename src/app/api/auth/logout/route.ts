import { cookies } from 'next/headers';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { IMPERSONATION_COOKIE, endImpersonation } from '@/server/platform-admin';
import { createServerSupabase } from '@/server/supabase';

export const POST = handle(async () => {
  const supabase = await createServerSupabase();
  // 代入中登出：先結束代入 session 並清 cookie，否則 30 分鐘內重新登入會無聲接回跨租戶代入，
  // 稽核也仍顯示進行中。沿用 impersonation/end 的做法；endImpersonation 以 admin_user_id 收窄且冪等
  const jar = await cookies();
  const sessionId = jar.get(IMPERSONATION_COOKIE)?.value;
  if (sessionId) {
    const { data } = await supabase.auth.getUser();
    // 結束失敗就直接丟出（500）：其餘狀態都不動，使用者可重試，不謊報已登出
    if (data.user) await endImpersonation(sessionId, data.user.id);
    jar.set(IMPERSONATION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
  // scope 'local'：預設 'global' 會撤銷該使用者所有裝置的 session；登出只應結束目前這個
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  // 不得吞掉 signOut 失敗：session 沒被撤銷卻回 200 等於謊報已登出
  if (error) throw new ApiHttpError(500, '登出失敗，請稍後再試', ERR.INTERNAL);
  return ok({ loggedOut: true });
});
