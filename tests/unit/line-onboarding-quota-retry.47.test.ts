import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execute the production hook's callbacks and effect cleanup without a DOM or network.
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, writes: 0,
  effect: undefined as undefined | (() => void | (() => void)),
  fetch: vi.fn(),
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [runtime.slots[index], (value: unknown) => {
      runtime.writes++;
      runtime.slots[index] = typeof value === 'function' ? value(runtime.slots[index]) : value;
    }];
  },
  useRef(initial: unknown) {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = { current: initial };
    return runtime.slots[index];
  },
  useCallback(callback: unknown) { return callback; },
  useEffect(effect: () => void | (() => void)) { runtime.effect = effect; },
}));
vi.mock('@/services/reports', () => ({ getDashboardStats: runtime.fetch }));
import { usePushQuota } from '@/lib/use-line-onboarding-quota';

function render() {
  runtime.cursor = 0;
  return usePushQuota();
}
function deferred() {
  let resolve!: (value: { pushQuotaUsed: number; pushQuotaTotal: number }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ pushQuotaUsed: number; pushQuotaTotal: number }>((yes, no) => {
    resolve = yes; reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  runtime.slots = []; runtime.cursor = 0; runtime.writes = 0;
  runtime.effect = undefined; runtime.fetch.mockReset();
});

describe('LINE onboarding quota card retry #47', () => {
  it('recovers from deferred mount failure, suppresses repeated retry, and displays fresh quota', async () => {
    const initial = deferred(); const retry = deferred();
    runtime.fetch.mockReturnValueOnce(initial.promise).mockReturnValueOnce(retry.promise);
    render(); const cleanup = runtime.effect!();
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
    initial.reject(new Error('temporary outage')); await flush();
    const card = render(); expect(card.quotaState).toEqual({ status: 'error' });
    const completion = card.retryQuota();
    await card.retryQuota(); await render().retryQuota();
    expect(runtime.fetch).toHaveBeenCalledTimes(2);
    expect(render().quotaState).toEqual({ status: 'loading' });
    retry.resolve({ pushQuotaUsed: 88, pushQuotaTotal: 100 }); await completion;
    expect(render().quotaState).toEqual({ status: 'ready', used: 88, total: 100 });
    if (typeof cleanup === 'function') cleanup();
  });

  it('keeps repeated failures recoverable without rejecting the card callback', async () => {
    runtime.fetch.mockRejectedValue(new Error('offline'));
    render(); runtime.effect!(); await flush();
    await render().retryQuota(); expect(render().quotaState).toEqual({ status: 'error' });
    runtime.fetch.mockResolvedValue({ pushQuotaUsed: 1, pushQuotaTotal: 10 });
    await render().retryQuota();
    expect(render().quotaState).toEqual({ status: 'ready', used: 1, total: 10 });
    expect(runtime.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['resolve', 'reject'] as const)('ignores a late %s after cleanup and forbids calls while unmounted', async (outcome) => {
    const pending = deferred(); runtime.fetch.mockReturnValue(pending.promise);
    const card = render(); const cleanup = runtime.effect!();
    if (typeof cleanup === 'function') cleanup();
    const writes = runtime.writes;
    if (outcome === 'resolve') pending.resolve({ pushQuotaUsed: 9, pushQuotaTotal: 10 });
    else pending.reject(new Error('late failure'));
    await flush(); await card.retryQuota();
    expect(runtime.writes).toBe(writes);
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('ignores stale %s after effect cleanup/restart and keeps the new request locked', async (outcome) => {
    const old = deferred(); const fresh = deferred();
    runtime.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    render(); const effect = runtime.effect!; const cleanup = effect();
    if (typeof cleanup === 'function') cleanup();
    effect();
    if (outcome === 'resolve') old.resolve({ pushQuotaUsed: 99, pushQuotaTotal: 100 });
    else old.reject(new Error('stale error'));
    await flush(); await render().retryQuota();
    expect(render().quotaState).toEqual({ status: 'loading' });
    expect(runtime.fetch).toHaveBeenCalledTimes(2);
    fresh.resolve({ pushQuotaUsed: 2, pushQuotaTotal: 50 }); await flush();
    expect(render().quotaState).toEqual({ status: 'ready', used: 2, total: 50 });
  });
});
