import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { USE_MOCK } from '@/config/env';

const PUBLIC_PATHS = ['/tenant/login', '/tenant/register',
                      '/tenant/forgot-password', '/tenant/reset-password'];

export async function middleware(req: NextRequest) {
  // ⚠️ 修正：原本直接比對 `process.env.NEXT_PUBLIC_USE_MOCK === 'true'`，
  // 未設定該變數時字面值是 undefined（不等於 'true'），middleware 會誤判為
  // 「非 mock 模式」而要求真實 Supabase session；但 src/config/env.ts 的
  // USE_MOCK 用 zod .default('true')，前端在同樣未設定的情況下判定為 mock
  // 模式（login/register 走假動作、不呼叫真後端）。兩邊認定不一致，會讓
  // 使用者在正式站「登入」後被 middleware 彈回登入頁（鐵則 10 要求
  // mock 模式全站行為一致，這裡改成共用同一個判斷來源）。
  if (USE_MOCK) return NextResponse.next();
  if (PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
        getAll: () => req.cookies.getAll(),
        // ⚠️ 偏離 03 分冊 §6.1 原文：原文的 `setAll: (all) => …` 在 TS strict 下是
        //    TS7006/TS7031 隱含 any（createServerClient 多載解析同 src/server/supabase.ts
        //    踩過的坑）。這裡補上 @supabase/ssr 匯出的型別，行為與原文完全相同。
        setAll: (all: { name: string; value: string; options: CookieOptions }[]) =>
          all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    } },
  );
  const { data: { user } } = await supabase.auth.getUser();  // 同時完成 token 續期
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/tenant/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ['/tenant/:path*'] };
