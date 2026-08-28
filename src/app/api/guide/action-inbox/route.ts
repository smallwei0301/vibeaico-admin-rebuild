import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { buildGuideActionInbox, guideInboxWindow, loadGuideActionSources } from '@/server/guide-action-inbox';

export const GET = handle(async () => {
  const tenant = await requireTenant();
  const { data: settings, error } = await tenant.supabase
    .from('tenant_settings').select('basic').eq('tenant_id', tenant.tenantId).maybeSingle();
  if (error) throw error;
  const basic = (settings?.basic ?? {}) as Record<string, unknown>;
  const timeZone = typeof basic.timezone === 'string' ? basic.timezone : undefined;
  const window = guideInboxWindow(new Date(), timeZone);
  const sources = await loadGuideActionSources({
    supabase: tenant.supabase, tenantId: tenant.tenantId,
    fromDate: window.fromDate, departureToDate: window.departureToDate,
    timeZone: window.timeZone, now: window.now,
  });
  return ok({ ...buildGuideActionInbox(sources, window), timeZone: window.timeZone });
});
