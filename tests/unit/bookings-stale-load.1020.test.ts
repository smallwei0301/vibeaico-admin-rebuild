import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLatestRequest } from '@/lib/booking-payment-filter';

describe('#1020 預約列表忽略過期查詢回應', () => {
  it('isLatestRequest 只在序號相同時為真', () => {
    expect(isLatestRequest(3, 3)).toBe(true);
    expect(isLatestRequest(2, 3)).toBe(false);
  });

  it('load 遞增 loadSeq，await 後與 catch 內檢查過期，finally 僅最新請求關閉 loading', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/tenant/bookings/page.tsx'), 'utf8');
    const start = src.indexOf('const load = React.useCallback');
    const end = src.indexOf('React.useEffect(() => { void load(); }');
    const body = src.slice(start, end);
    expect(body).toContain('const seq = ++loadSeq.current;');
    const check = 'if (!isLatestRequest(seq, loadSeq.current)) return;';
    expect(body.split(check).length - 1).toBe(3); // 主查詢、deep-link 補查、catch
    const mainAwait = body.indexOf('await listBookings({ ...filterParams, page, size');
    expect(body.indexOf(check, mainAwait)).toBeGreaterThan(mainAwait);
    expect(body.indexOf(check, mainAwait)).toBeLessThan(body.indexOf('setPage('));
    const exactAwait = body.indexOf('const exact = await');
    expect(body.indexOf(check, exactAwait)).toBeLessThan(body.indexOf('setDetailTarget(requested)'));
    const catchAt = body.indexOf('} catch (e) {');
    expect(body.indexOf(check, catchAt)).toBeLessThan(body.indexOf('toast.show', catchAt));
    expect(body.lastIndexOf(check, body.indexOf('lastListFiltersRef.current = filterParams')))
      .toBeGreaterThan(exactAwait);
    expect(body).toContain('if (isLatestRequest(seq, loadSeq.current)) setLoading(false);');
  });
});
