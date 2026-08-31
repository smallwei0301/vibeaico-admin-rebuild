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

export interface SyntheticProbeDelivery {
  channel: NotificationChannel;
  status: DeliveryStatus;
  lastErrorCode?: string | null;
}

/**
 * The preceding platform-health delivery is the synthetic probe: it reaches
 * the same platform Email/Telegram transports without sending a second probe
 * message. Provider evidence remains truthful—only ACCEPTED/DELIVERED is OK.
 */
export function syntheticTransportProbeFromLedger(rows: SyntheticProbeDelivery[]): SyntheticTransportProbe {
  const probe = defaultSyntheticTransportProbe();
  const set = (channel: 'EMAIL' | 'TELEGRAM', outcome: SyntheticProbeOutcome) => {
    const current = channel === 'EMAIL' ? probe.email : probe.telegram;
    // A later positive callback must not hide a retry/dead configuration or
    // transport failure recorded for the same probe window.
    if (current === 'FAILED' || (current === 'OK' && outcome === 'NOT_RUN')) return;
    if (channel === 'EMAIL') probe.email = outcome;
    else probe.telegram = outcome;
  };
  for (const row of rows) {
    if (row.channel !== 'EMAIL' && row.channel !== 'TELEGRAM') continue;
    if (row.status === 'ACCEPTED' || row.status === 'DELIVERED') set(row.channel, 'OK');
    if (row.status === 'RETRY' || row.status === 'DEAD'
      || (row.status === 'SKIPPED' && row.lastErrorCode === 'NOT_CONFIGURED')) set(row.channel, 'FAILED');
  }
  return probe;
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

/**
 * Fixed first-version thresholds. Keep the live dispatcher and daily digest on
 * this one policy until the product adds operator-configurable alert rules.
 */
export const HEALTH_ALERT_POLICY = {
  authFailureThreshold: 3,
  pendingAgeSeconds: 30 * 60,
  providerBurstThreshold: 5,
  providerBurstWindowMs: 5 * 60_000,
} as const;

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
  const authFailures = [...errors.entries()]
    .filter(([code]) => code === 'HTTP_401' || code === 'HTTP_403')
    .reduce((total, [, count]) => total + count, 0) >= HEALTH_ALERT_POLICY.authFailureThreshold;
  const rateLimitBurst = (errors.get('HTTP_429') ?? 0) >= HEALTH_ALERT_POLICY.providerBurstThreshold;
  const serverFailureBurst = [...errors.entries()].some(([code, count]) => /^HTTP_5\d\d$/.test(code) && count >= HEALTH_ALERT_POLICY.providerBurstThreshold);
  const syntheticTransportFailure = Object.values(digest.syntheticTransportProbe).includes('FAILED');
  return [
    ...(dead ? ['CRITICAL_DELIVERY_DEAD'] : []),
    ...(authFailures ? ['PROVIDER_AUTH_FAILURE'] : []),
    ...(digest.oldestPendingAgeSeconds !== null && digest.oldestPendingAgeSeconds >= HEALTH_ALERT_POLICY.pendingAgeSeconds ? ['PENDING_TOO_OLD'] : []),
    ...(rateLimitBurst ? ['PROVIDER_RATE_LIMIT_BURST'] : []),
    ...(serverFailureBurst ? ['PROVIDER_5XX_BURST'] : []),
    ...(syntheticTransportFailure ? ['SYNTHETIC_TRANSPORT_FAILURE'] : []),
  ];
}
