import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** 帶使用者 session（cookie）的 client —— 一般 API 一律用這個，RLS 生效 */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(URL_(), ANON(), {
    cookies: {
      getAll: () => store.getAll(),
      // ⚠️ 偏離 01 分冊 §5.2 原文：原文的 `setAll: (all) => …` 在 TS strict 下是
      //    TS7006/TS7031 隱含 any —— createServerClient 有 deprecated/現行兩個多載，
      //    多載解析時無法對回呼參數做上下文推導。這裡補上 @supabase/ssr 匯出的型別，
      //    行為與原文完全相同，只是把型別寫明。
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) =>
        all.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}

/** service role client —— 僅限受明確 server-side auth guard 保護的內部流程 */
export function createAdminSupabase() {
  return createClient(URL_(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
