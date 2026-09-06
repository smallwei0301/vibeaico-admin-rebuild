import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/bookings/[id]/route.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/services/bookings.ts'),
  'utf8',
);
const pageSource = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/bookings/page.tsx'),
  'utf8',
);
const copySource = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/bookings.ts'),
  'utf8',
);

describe('booking modification notification contract (#27)', () => {
  it('triggers MODIFIED after a successful update without awaiting delivery', () => {
    expect(routeSource).toContain("import { notifyBookingStatus } from '@/server/line-notify';");
    const update = routeSource.indexOf(".from('bookings')\n    .update(update)");
    const notify = routeSource.indexOf(
      "void notifyBookingStatus(t.tenantId, id, 'MODIFIED')",
    );

    expect(update).toBeGreaterThanOrEqual(0);
    expect(notify).toBeGreaterThan(update);
    expect(routeSource).not.toContain("await notifyBookingStatus(t.tenantId, id, 'MODIFIED')");
  });

  it('exposes whether a customer-facing notification was triggered', () => {
    expect(routeSource).toContain('notifyTriggered');
    expect(routeSource).toContain('return ok({ notifyTriggered: false })');
    expect(serviceSource).toContain('request<UpdateBookingResult>');
    expect(pageSource).toContain('result?.notifyTriggered');
  });

  it('does not promise a LINE notification for an internal note-only edit', () => {
    expect(copySource).toContain('店內備註');
    expect(copySource).toContain('不會觸發 LINE 通知');
  });
});
