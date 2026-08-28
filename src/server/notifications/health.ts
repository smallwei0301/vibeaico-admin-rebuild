import type { DeliveryStatus, NotificationChannel } from './delivery';

export interface HealthDelivery {
  tenantId: string | null;
  channel: NotificationChannel;
  status: DeliveryStatus;
  createdAt: string;
  lastErrorCode?: string | null;
}

export interface ChannelHealth {
  accepted: number;
  delivered: number;
  retry: number;
  dead: number;
  skipped: number;
  invalidBinding: number;
}

export interface HealthDigest {
  periodStart: string;
  periodEnd: string;
  logicalEvents: number;
  channels: Record<NotificationChannel, ChannelHealth>;
  oldestPendingAgeSeconds: number | null;
  topErrorCodes: Array<{ code: string; count: number }>;
  /** Complete non-PII error counts for threshold evaluation; reports render only topErrorCodes. */
  errorCounts: Record<string, number>;
  impactedTenantIds: string[];
}

/** Fixed first-version thresholds. They are deliberately visible in one place
 * until the product adds an operator-configurable alert policy. */
const AUTH_FAILURE_THRESHOLD = 3;
const PENDING_AGE_THRESHOLD_SECONDS = 30 * 60;
const PROVIDER_BURST_THRESHOLD = 5;

const emptyChannel = (): ChannelHealth => ({ accepted: 0, delivered: 0, retry: 0, dead: 0, skipped: 0, invalidBinding: 0 });

/**
 * Builds the persisted digest payload. It accepts pre-filtered rows so the
 * database query remains an I/O concern and this contract is fully unit-testable.
 */
export function buildHealthDigest(rows: HealthDelivery[], end = new Date(), logicalEvents = 0, pendingRows: HealthDelivery[] = rows): HealthDigest {
  const periodEnd = end.toISOString();
  const periodStart = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const channels: Record<NotificationChannel, ChannelHealth> = {
    EMAIL: emptyChannel(), TELEGRAM: emptyChannel(), LINE: emptyChannel(),
  };
  const errors = new Map<string, number>();
  const impacted = new Set<string>();
  let oldestPendingAt: number | null = null;

  for (const row of rows) {
    const bucket = channels[row.channel];
    if (row.status === 'ACCEPTED') bucket.accepted++;
    if (row.status === 'DELIVERED') bucket.delivered++;
    if (row.status === 'RETRY') bucket.retry++;
    if (row.status === 'DEAD') bucket.dead++;
    if (row.status === 'SKIPPED') bucket.skipped++;
    if (row.status === 'DEAD' && row.channel === 'TELEGRAM' && row.lastErrorCode === 'TELEGRAM_BLOCKED')
      bucket.invalidBinding++;
    if (row.status === 'RETRY' || row.status === 'DEAD') {
      if (row.tenantId) impacted.add(row.tenantId);
      if (row.lastErrorCode) errors.set(row.lastErrorCode, (errors.get(row.lastErrorCode) ?? 0) + 1);
    }
  }
  for (const row of pendingRows) {
    if (row.status === 'PENDING' || row.status === 'PROCESSING' || row.status === 'RETRY') {
      const at = Date.parse(row.createdAt);
      if (!Number.isNaN(at) && (oldestPendingAt === null || at < oldestPendingAt)) oldestPendingAt = at;
    }
  }

  return {
    periodStart,
    periodEnd,
    logicalEvents,
    channels,
    oldestPendingAgeSeconds: oldestPendingAt === null ? null : Math.max(0, Math.floor((end.getTime() - oldestPendingAt) / 1000)),
    topErrorCodes: [...errors.entries()]
      .sort(([leftCode, leftCount], [rightCode, rightCount]) => rightCount - leftCount || leftCode.localeCompare(rightCode))
      .slice(0, 5)
      .map(([code, count]) => ({ code, count })),
    errorCounts: Object.fromEntries(errors),
    impactedTenantIds: [...impacted].sort(),
  };
}

/** Platform alert events to enqueue; these codes contain no recipient PII. */
export function immediateAlertCodes(digest: HealthDigest): string[] {
  const errors = new Map(Object.entries(digest.errorCounts));
  const dead = Object.values(digest.channels).some((channel) => channel.dead > 0);
  const authFailures = [...errors.entries()].some(([code, count]) => (code === 'HTTP_401' || code === 'HTTP_403') && count >= AUTH_FAILURE_THRESHOLD);
  const rateLimitBurst = (errors.get('HTTP_429') ?? 0) >= PROVIDER_BURST_THRESHOLD;
  const serverFailureBurst = [...errors.entries()].some(([code, count]) => /^HTTP_5\d\d$/.test(code) && count >= PROVIDER_BURST_THRESHOLD);
  return [
    ...(dead ? ['CRITICAL_DELIVERY_DEAD'] : []),
    ...(authFailures ? ['PROVIDER_AUTH_FAILURE'] : []),
    ...(digest.oldestPendingAgeSeconds !== null && digest.oldestPendingAgeSeconds >= PENDING_AGE_THRESHOLD_SECONDS ? ['PENDING_TOO_OLD'] : []),
    ...(rateLimitBurst ? ['PROVIDER_RATE_LIMIT_BURST'] : []),
    ...(serverFailureBurst ? ['PROVIDER_5XX_BURST'] : []),
  ];
}
