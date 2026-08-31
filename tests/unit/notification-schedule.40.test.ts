import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vercel = readFileSync('vercel.json', 'utf8');
const cronDoc = readFileSync('docs/integration/07-DEPLOYMENT-CRON.md', 'utf8');
const notificationDoc = readFileSync('docs/integration/17-NOTIFICATION-DELIVERY.md', 'utf8');
const healthRoute = readFileSync('src/app/api/cron/notification-health/route.ts', 'utf8');

describe('notification health schedule (#40, 07 §2, 17 §6)', () => {
  it('uses the same 01:00 UTC / 09:00 Asia-Taipei schedule in config, route, and canonical docs', () => {
    expect(vercel).toContain('"path": "/api/cron/notification-health", "schedule": "0 1 * * *"');
    expect(healthRoute).toContain('Daily 09:00 Asia/Taipei report (01:00 UTC)');
    expect(cronDoc).toContain('notification-health 都在 01:00 UTC 排程');
    expect(cronDoc).toContain('每日 `01:00 UTC`（台北 09:00）');
    expect(notificationDoc).toContain('台北時間 09:00（`01:00 UTC`）');
  });

  it('documents execution-time cutoff and Hobby jitter rather than a false exact-time SLA', () => {
    expect(cronDoc).toContain('cutoff 是 route 實際執行時間');
    expect(cronDoc).toContain('±59 分鐘 jitter');
    expect(notificationDoc).toContain('以 route 實際執行的時間為 cutoff');
    expect(notificationDoc).toContain('±59 分鐘 jitter');
  });
});
