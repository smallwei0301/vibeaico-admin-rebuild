import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  const { data, error } = await t.supabase.from('trips').update({ status: 'DRAFT' })
    .eq('tenant_id', t.tenantId).eq('id', id).eq('status', 'PUBLISHED')
    .select('id, status').maybeSingle();
  if (error) throw error;
  if (data) return ok(data);
  const { data: existing, error: readError } = await t.supabase.from('trips').select('id, status')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  return fail(409, '只有已發佈行程可以下架', ERR.CONFLICT);
});
