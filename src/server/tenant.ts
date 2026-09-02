import { createAdminSupabase, createServerSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';
import { cookies } from 'next/headers';

export const ACTIVE_TENANT_COOKIE = 'vibeai_active_tenant';

export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ApiHttpError(401, '請先登入', ERR.UNAUTHORIZED);
  return { supabase, user };
}

/**
 * 解析目前操作的店家：
 * 1. cookie vibeai_active_tenant 指定且使用者是成員 → 用它
 * 2. 否則取使用者第一個成員資格
 * 回傳的 supabase client 已帶 session，之後查業務表都用它（RLS 把關）。
 */
export async function requireTenant(minRole: 'STAFF' | 'MANAGER' | 'OWNER' = 'STAFF') {
  const { supabase, user } = await requireUser();
  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name)')
    .eq('user_id', user.id);
  if (error || !memberships?.length)
    throw new ApiHttpError(403, '此帳號未加入任何店家', ERR.FORBIDDEN);

  const want = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const m = memberships.find((x) => x.tenant_id === want) ?? memberships[0];

  const rank = { STAFF: 0, MANAGER: 1, OWNER: 2 } as const;
  if (rank[m.role as keyof typeof rank] < rank[minRole])
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);

  return { supabase, user, tenantId: m.tenant_id as string, role: m.role as string,
           shopCode: (m as any).tenants.shop_code as string,
           tenantName: (m as any).tenants.name as string };
}

/**
 * Manager-only API data client.
 *
 * Authentication, tenant selection, and role checks still run through the
 * cookie-backed client above. Once those checks pass, manager mutations use a
 * server-only service-role client because the core tour tables are read-only
 * to the public REST roles. Callers must keep every business query explicitly
 * scoped to the selected tenant and validated parent ids.
 */
export async function requireTenantManager() {
  const t = await requireTenant('MANAGER');
  return { ...t, supabase: createAdminSupabase() };
}
