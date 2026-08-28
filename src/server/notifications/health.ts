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

export type SyntheticProbeOutcome = 'NOT_RUN' | 'OK' | 'FAILED';

/**
 * Transport smoke results are injected by a future probe runner. Building or
 * formatting a digest never calls an external provider by itself.
 */
export interface SyntheticTransportProbe {
  email: SyntheticProbeOutcome;
  telegram: SyntheticProbeOutcome;
  line: SyntheticProbeOutcome;
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
  syntheticTransportProbe: SyntheticTransportProbe;
}

/** Fixed first-version thresholds. They are deliberately visible in one place
 * until the product adds an operator-configurable alert policy. */
const AUTH_FAILURE_THRESHOLD = 3;
const PENDING_AGE_THRESHOLD_SECONDS = 30 * 60;
const PROVIDER_BURST_THRESHOLD = 5;

const emptyChannel = (): ChannelHealth => ({ accepted: 0, delivered: 0, retry: 0, dead: 0, skipped: 0, invalidBinding: 0 });
const defaultSyntheticTransportProbe = (): SyntheticTransportProbe => ({ email: 'NOT_RUN', telegram: 'NOT_RUN', line: 'NOT_RUN' });

/**
 * Builds the persisted digest payload. It accepts pre-filtered rows so the
 * database query remains an I/O concern and this contract is fully unit-testable.
 */
export function buildHealthDigest(
  rows: HealthDelivery[],
  end = new Date(),
  logicalEvents = 0,
  pendingRows: HealthDelivery[] = rows,
  syntheticTransportProbe: Partial<SyntheticTransportProbe> = {},
): HealthDigest {
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
    syntheticTransportProbe: { ...defaultSyntheticTransportProbe(), ...syntheticTransportProbe },
  };
}

/** Render the complete, PII-minimal 17 §6 operator digest payload. */
export function formatHealthDigest(digest: HealthDigest): string {
  const channel = (name: 'Email' | 'Telegram' | 'LINE', stats: ChannelHealth) =>
    `${name} accepted ${stats.accepted}; delivered ${stats.delivered}; retry ${stats.retry}; dead ${stats.dead}; skipped ${stats.skipped}; invalid binding ${stats.invalidBinding}`;
  const errors = digest.topErrorCodes.length
    ? digest.topErrorCodes.map(({ code, count }) => `${code} (${count})`).join(', ')
    : 'none';
  return [
    'VibeAI notification health (previous 24h)',
    `Period: ${digest.periodStart} → ${digest.periodEnd}`,
    `Logical events: ${digest.logicalEvents}`,
    channel('Email', digest.channels.EMAIL),
    channel('Telegram', digest.channels.TELEGRAM),
    channel('LINE', digest.channels.LINE),
    `Oldest pending: ${digest.oldestPendingAgeSeconds === null ? 'none' : `${digest.oldestPendingAgeSeconds}s`}`,
    `Top errors: ${errors}`,
    `Impacted tenants: ${digest.impactedTenantIds.length ? digest.impactedTenantIds.join(', ') : 'none'}`,
    `Synthetic transport probe: Email ${digest.syntheticTransportProbe.email}; Telegram ${digest.syntheticTransportProbe.telegram}; LINE ${digest.syntheticTransportProbe.line}`,
  ].join('\n');
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
