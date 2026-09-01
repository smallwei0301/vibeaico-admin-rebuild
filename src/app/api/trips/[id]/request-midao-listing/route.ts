import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const POST = handle(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  const { data, error } = await t.supabase.from('trips').update({ midao_listing: 'PENDING' })
    .eq('tenant_id', t.tenantId).eq('id', id).in('midao_listing', ['NONE', 'REJECTED'])
    .select('id, midao_listing').maybeSingle();
  if (error) throw error;
  if (data) return ok({ id: data.id, midaoListing: data.midao_listing });
  const { data: existing, error: readError } = await t.supabase.from('trips').select('id, midao_listing')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  return fail(409, '此行程目前無法重複申請上架', ERR.CONFLICT);
});
