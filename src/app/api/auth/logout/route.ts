import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { createServerSupabase } from '@/server/supabase';

export const POST = handle(async () => {
  const supabase = await createServerSupabase();
  // scope 'local'：預設 'global' 會撤銷該使用者所有裝置的 session；登出只應結束目前這個
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  // 不得吞掉 signOut 失敗：session 沒被撤銷卻回 200 等於謊報已登出
  if (error) throw new ApiHttpError(500, '登出失敗，請稍後再試', ERR.INTERNAL);
  return ok({ loggedOut: true });
});
