import { handle, ok } from '@/server/http';
import { buildGuideActionInbox, guideInboxWindow, loadGuideActionSources } from '@/server/guide-action-inbox';
import { requireTenant } from '@/server/tenant';

// GET /api/guide/action-inbox — derives GUIDE work from tenant-owned business state.
export const GET = handle(async () => {
  const tenant = await requireTenant();
  const { data: settings, error } = await tenant.supabase
    .from('tenant_settings')
    .select('basic')
    .eq('tenant_id', tenant.tenantId)
    .maybeSingle();
  if (error) throw error;

  // The current settings schema has no required timezone field. Preserve forward compatibility
  // while normalizing to Asia/Taipei rather than reading the process timezone.
  const basic = (settings?.basic ?? {}) as Record<string, unknown>;
  const configuredTimeZone = typeof basic.timezone === 'string' ? basic.timezone : undefined;
  const window = guideInboxWindow(new Date(), configuredTimeZone);
  const sources = await loadGuideActionSources({
    supabase: tenant.supabase,
    tenantId: tenant.tenantId,
    fromDate: window.fromDate,
    departureToDate: window.departureToDate,
    timeZone: window.timeZone,
    now: window.now,
  });

  return ok({
    ...buildGuideActionInbox(sources, window),
    timeZone: window.timeZone,
  });
});
