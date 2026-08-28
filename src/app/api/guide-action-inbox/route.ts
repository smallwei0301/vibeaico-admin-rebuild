import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { buildGuideActionInbox, guideInboxWindow, loadGuideActionSources } from '@/server/guide-action-inbox';

export const GET = handle(async () => {
  const tenant = await requireTenant();
  const now = new Date();
  const { data: settings, error: settingsError } = await tenant.supabase
    .from('tenant_settings').select('basic').eq('tenant_id', tenant.tenantId).maybeSingle();
  if (settingsError) throw settingsError;
  const basic = (settings?.basic ?? {}) as Record<string, unknown>;
  const timeZone = typeof basic.timezone === 'string' && basic.timezone ? basic.timezone : 'Asia/Taipei';
  const window = guideInboxWindow(now, timeZone);
  const sources = await loadGuideActionSources({
    supabase: tenant.supabase,
    tenantId: tenant.tenantId,
    fromDate: window.fromDate,
    toDate: window.toDate,
  });

  return ok(buildGuideActionInbox(sources, window));
});
