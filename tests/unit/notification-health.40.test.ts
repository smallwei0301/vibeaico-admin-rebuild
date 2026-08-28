import { describe, expect, it } from 'vitest';
import { buildHealthDigest, formatHealthDigest, immediateAlertCodes, type HealthDelivery } from '@/server/notifications/health';

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
