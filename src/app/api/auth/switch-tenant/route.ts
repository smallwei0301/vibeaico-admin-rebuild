import { z } from 'zod';
import { cookies } from 'next/headers';
import { handle, ok, fail, ERR, readJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES } from '@/server/http';
import { requireUser, ACTIVE_TENANT_COOKIE } from '@/server/tenant';

const bodySchema = z.object({ tenantId: z.string().uuid() });

export const POST = handle(async (req) => {
  const { tenantId } = bodySchema.parse(await readJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES));
  const { supabase, user } = await requireUser();

  const { data: membership } = await supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return fail(403, '您不是此店家的成員', ERR.FORBIDDEN);

  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly: true, path: '/', sameSite: 'lax' });
  return ok({ switched: true });
});
