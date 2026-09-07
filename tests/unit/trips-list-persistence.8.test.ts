import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/page.tsx'), 'utf8');

describe('#8 行程列表持久化接線', () => {
  it('把列表上的四個真實操作接到既有 tenant-scoped service', () => {
    expect(source).toContain(
      "import { deleteTrip, listTrips, publishTrip, requestMidaoListing } from '@/services/tours';",
    );
    expect(source).toContain('() => publishTrip(trip.id, true)');
    expect(source).toContain('() => publishTrip(target.id, false)');
    expect(source).toContain('() => requestMidaoListing(target.id)');
    expect(source).toContain('() => deleteTrip(target.id)');
  });

  it('先等待 API 成功，再重新讀取真實列表；mock 才使用本地適配器', () => {
    expect(source).toContain('await action();');
    expect(source).toContain('} else if (!(await load())) {');
    expect(source).toContain('if (USE_MOCK) {');
    expect(source).toContain('mutationFailed');
  });

  it('不再由發布、下架、申請或刪除 handler 直接假造成功狀態', () => {
    for (const handler of ['togglePublish', 'doUnpublish', 'doRequestMidao', 'doDelete']) {
      const start = source.indexOf('const ' + handler);
      expect(start, handler).toBeGreaterThanOrEqual(0);
      const end = source.indexOf('\n  const ', start + 1);
      const body = source.slice(start, end === -1 ? source.length : end);
      expect(body).toContain('runMutation');
      expect(body).not.toContain('toast.show(t.messages.');
    }
  });
});
