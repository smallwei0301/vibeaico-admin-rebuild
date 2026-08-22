import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PUBLIC_PATHS = ['/tenant/login', '/tenant/register',
                      '/tenant/forgot-password', '/tenant/reset-password'];

export async function middleware(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') return NextResponse.next(); // 鐵則 10
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
