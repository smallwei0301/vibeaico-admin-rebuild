import { describe, expect, it, vi } from 'vitest';
import { createDailyHealthReport } from '@/server/notifications/health-report';
import {
  buildHealthDigest,
  formatHealthDigest,
  immediateAlertCodes,
  syntheticTransportProbeFromLedger,
  type HealthDelivery,
} from '@/server/notifications/health';

describe('notification health digest (#40, 17 §6)', () => {
  it('creates a report even when the preceding day has zero failures', () => {
    const report = buildHealthDigest([], new Date('2030-06-05T01:00:00.000Z'));
    expect(report.periodStart).toBe('2030-06-04T01:00:00.000Z');
    expect(report.channels.EMAIL).toMatchObject({ accepted: 0, delivered: 0, retry: 0, dead: 0 });
    expect(report.impactedTenantIds).toEqual([]);
  });

  it('counts each provider state without calling accepted or Telegram 200 delivered/read', () => {
    const report = buildHealthDigest([
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'ACCEPTED', createdAt: '2030-06-04T02:00:00.000Z' },
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'DELIVERED', createdAt: '2030-06-04T03:00:00.000Z' },
      { tenantId: 'tenant-b', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T04:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-b', channel: 'TELEGRAM', status: 'DEAD', createdAt: '2030-06-04T05:00:00.000Z', lastErrorCode: 'TELEGRAM_BLOCKED' },
    ], new Date('2030-06-05T01:00:00.000Z'));
    expect(report.channels.EMAIL).toMatchObject({ accepted: 1, delivered: 1, retry: 0, dead: 0 });
    expect(report.channels.TELEGRAM).toMatchObject({ accepted: 0, delivered: 0, retry: 1, dead: 1, invalidBinding: 1 });
    expect(report.topErrorCodes).toEqual([
      { code: 'HTTP_429', count: 1 }, { code: 'TELEGRAM_BLOCKED', count: 1 },
    ]);
    expect(report.impactedTenantIds).toEqual(['tenant-b']);
  });

  it('reports the age of the oldest still-pending delivery', () => {
    const report = buildHealthDigest([
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'PENDING', createdAt: '2030-06-04T22:00:00.000Z' },
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z' },
    ], new Date('2030-06-05T01:00:00.000Z'));
    expect(report.oldestPendingAgeSeconds).toBe(18_000);
  });

  it('raises configured platform-alert reasons for dead letters, persistent auth, stale pending, and bursts', () => {
    const digest = buildHealthDigest([
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'DEAD', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_401' },
      { tenantId: 'tenant-b', channel: 'EMAIL', status: 'DEAD', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_401' },
      { tenantId: 'tenant-c', channel: 'EMAIL', status: 'DEAD', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_401' },
      { tenantId: 'tenant-d', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-e', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-f', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-g', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-h', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429' },
    ], new Date('2030-06-05T01:00:00.000Z'));
    expect(immediateAlertCodes(digest)).toEqual([
      'CRITICAL_DELIVERY_DEAD', 'PROVIDER_AUTH_FAILURE', 'PENDING_TOO_OLD', 'PROVIDER_RATE_LIMIT_BURST',
    ]);
  });

  it('derives synthetic probe evidence from prior platform-health ledger rows without calling a provider', () => {
    const probe = syntheticTransportProbeFromLedger([
      { channel: 'EMAIL', status: 'ACCEPTED' },
      { channel: 'TELEGRAM', status: 'SKIPPED', lastErrorCode: 'NOT_CONFIGURED' },
      { channel: 'TELEGRAM', status: 'DELIVERED' },
      { channel: 'LINE', status: 'DEAD' },
    ]);
    const digest = buildHealthDigest([], new Date('2030-06-05T01:00:00.000Z'), 0, [], probe);

    expect(probe).toEqual({ email: 'OK', telegram: 'FAILED', line: 'NOT_RUN' });
    expect(immediateAlertCodes(digest)).toContain('SYNTHETIC_TRANSPORT_FAILURE');
    expect(formatHealthDigest(digest)).toContain('Synthetic transport probe: Email OK; Telegram FAILED; LINE NOT_RUN');
  });

  it('persists the ledger-derived probe and creates both platform-health recipient ledger rows', async () => {
    const result = (value: unknown) => {
      const query = {
        select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn(), lt: vi.fn(),
      } as Record<string, ReturnType<typeof vi.fn>>;
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.in.mockReturnValue(query);
      query.gte.mockReturnValue(query);
      query.lt.mockResolvedValue(value);
      return query;
    };
    const deliveries = result({ data: [], error: null });
    const pending = result({ data: [], error: null });
    const probe = result({ data: [{ channel: 'EMAIL', status: 'ACCEPTED', last_error_code: null }], error: null });
    const events = result({ count: 0, error: null });
    const report = { upsert: vi.fn(), select: vi.fn(), single: vi.fn() };
    report.upsert.mockReturnValue(report);
    report.select.mockReturnValue(report);
    report.single.mockResolvedValue({ data: { id: 'report-1' }, error: null });
    const platformOutbox = { upsert: vi.fn(), select: vi.fn(), single: vi.fn() };
    platformOutbox.upsert.mockReturnValue(platformOutbox);
    platformOutbox.select.mockReturnValue(platformOutbox);
    platformOutbox.single.mockResolvedValue({ data: { id: 'outbox-1' }, error: null });
    const recipients = { upsert: vi.fn().mockResolvedValue({ error: null }) };
    const deliveryReads = [deliveries, pending, probe];
    const outboxReads = [events, platformOutbox];
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'notification_deliveries') return deliveryReads.shift() ?? recipients;
        if (table === 'notification_outbox') return outboxReads.shift();
        if (table === 'notification_health_reports') return report;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const end = new Date('2030-06-05T01:00:00.000Z');

    const digest = await createDailyHealthReport(admin as never, end);

    expect(probe.eq).toHaveBeenCalledWith('notification_outbox.event_name', 'PLATFORM_NOTIFICATION_HEALTH');
    expect(probe.in).toHaveBeenCalledWith('channel', ['EMAIL', 'TELEGRAM']);
    expect(probe.gte).toHaveBeenCalledWith('created_at', '2030-06-04T01:00:00.000Z');
    expect(probe.lt).toHaveBeenCalledWith('created_at', '2030-06-05T01:00:00.000Z');
    expect(digest.syntheticTransportProbe).toEqual({ email: 'OK', telegram: 'NOT_RUN', line: 'NOT_RUN' });
    expect(report.upsert).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ syntheticTransportProbe: digest.syntheticTransportProbe }) }), expect.anything());
    expect(platformOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({ event_name: 'PLATFORM_NOTIFICATION_HEALTH' }), expect.anything());
    expect(recipients.upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ channel: 'EMAIL', outbox_id: 'outbox-1' }),
      expect.objectContaining({ channel: 'TELEGRAM', outbox_id: 'outbox-1' }),
    ]), expect.anything());
  });

  it('keeps alert thresholds correct even when an error code is outside the five report rows', () => {
    const rows: HealthDelivery[] = Array.from({ length: 6 }, (_, index) => ({
      tenantId: `tenant-${index}`, channel: 'EMAIL' as const, status: 'RETRY' as const,
      createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: `OTHER_${index}`,
    }));
    rows.push(...Array.from({ length: 5 }, (_, index) => ({
      tenantId: `rate-${index}`, channel: 'TELEGRAM' as const, status: 'RETRY' as const,
      createdAt: '2030-06-04T20:00:00.000Z', lastErrorCode: 'HTTP_429',
    })));
    const digest = buildHealthDigest(rows, new Date('2030-06-05T01:00:00.000Z'));
    expect(digest.topErrorCodes).toHaveLength(5);
    expect(immediateAlertCodes(digest)).toContain('PROVIDER_RATE_LIMIT_BURST');
  });

  it('uses an older pending delivery for the age alert without adding it to daily channel counts', () => {
    const end = new Date('2030-06-05T01:00:00.000Z');
    const digest = buildHealthDigest([], end, 0, [
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'RETRY', createdAt: '2030-06-03T20:00:00.000Z', lastErrorCode: 'HTTP_503' },
    ]);
    expect(digest.channels.EMAIL.retry).toBe(0);
    expect(digest.oldestPendingAgeSeconds).toBe(104_400);
    expect(immediateAlertCodes(digest)).toContain('PENDING_TOO_OLD');
  });

  it('formats every canonical owner-digest dimension without performing a transport probe', () => {
    const digest = buildHealthDigest([
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'ACCEPTED', createdAt: '2030-06-04T21:00:00.000Z' },
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'DELIVERED', createdAt: '2030-06-04T21:00:00.000Z' },
      { tenantId: 'tenant-a', channel: 'EMAIL', status: 'SKIPPED', createdAt: '2030-06-04T21:00:00.000Z' },
      { tenantId: 'tenant-b', channel: 'TELEGRAM', status: 'RETRY', createdAt: '2030-06-04T22:00:00.000Z', lastErrorCode: 'HTTP_429' },
      { tenantId: 'tenant-b', channel: 'TELEGRAM', status: 'DEAD', createdAt: '2030-06-04T23:00:00.000Z', lastErrorCode: 'TELEGRAM_BLOCKED' },
      { tenantId: 'tenant-c', channel: 'LINE', status: 'ACCEPTED', createdAt: '2030-06-04T23:00:00.000Z' },
      { tenantId: 'tenant-c', channel: 'LINE', status: 'SKIPPED', createdAt: '2030-06-04T23:00:00.000Z' },
    ], new Date('2030-06-05T00:00:00.000Z'), 7);

    expect(formatHealthDigest(digest)).toContain('Period: 2030-06-04T00:00:00.000Z → 2030-06-05T00:00:00.000Z');
    expect(formatHealthDigest(digest)).toContain('Email accepted 1; delivered 1; retry 0; dead 0; skipped 1; invalid binding 0');
    expect(formatHealthDigest(digest)).toContain('Telegram accepted 0; delivered 0; retry 1; dead 1; skipped 0; invalid binding 1');
    expect(formatHealthDigest(digest)).toContain('LINE accepted 1; delivered 0; retry 0; dead 0; skipped 1; invalid binding 0');
    expect(formatHealthDigest(digest)).toContain('Oldest pending: 7200s');
    expect(formatHealthDigest(digest)).toContain('Top errors: HTTP_429 (1), TELEGRAM_BLOCKED (1)');
    expect(formatHealthDigest(digest)).toContain('Impacted tenants: tenant-b');
    expect(formatHealthDigest(digest)).toContain('Synthetic transport probe: Email NOT_RUN; Telegram NOT_RUN; LINE NOT_RUN');
  });
});
