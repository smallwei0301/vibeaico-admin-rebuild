import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const GET = handle(async () => {
  const t = await requireTenant();
  return ok({
    email: t.user.email,
    tenantId: t.tenantId,
    tenantName: t.tenantName,
    shopCode: t.shopCode,
    role: t.role,
  });
});
