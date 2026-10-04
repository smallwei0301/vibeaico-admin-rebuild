import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { AUTH_REAL } from '@/config/env';

const PUBLIC_PATHS = ['/tenant/login', '/tenant/register',
                      '/tenant/forgot-password', '/tenant/reset-password'];

export async function middleware(req: NextRequest) {
  // #754：session 保護只看認證模式 AUTH_REAL，與業務 USE_MOCK 無關。
  // AUTH_REAL 由 resolveAuthMode() 以「原始 env」判斷：明確 mock（NEXT_PUBLIC_USE_MOCK=true
  // 或 NEXT_PUBLIC_AUTH_MODE=mock）才放行；未設定或 false 一律 fail-closed 要求真 session，
  // 避免 Production 缺值時前端走假登入、受保護頁卻形同公開。
  if (!AUTH_REAL) return NextResponse.next();
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
