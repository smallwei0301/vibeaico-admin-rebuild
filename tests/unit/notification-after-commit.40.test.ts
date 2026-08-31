import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { after, from } = vi.hoisted(() => ({ after: vi.fn(), from: vi.fn() }));

vi.mock('next/server', () => ({ after }));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => ({ from }) }));

const { dispatchAfterCommit } = await import('@/server/notifications/outbox');

describe('post-commit notification dispatch (#40, 17 §2)', () => {
  beforeEach(() => {
    after.mockReset();
    from.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('registers work with Next after() so it outlives the completed route response', () => {
    dispatchAfterCommit('outbox-1');
    expect(after).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledWith(expect.any(Function));
  });

  it('swallows and logs a deferred dispatcher failure when Next invokes the callback', async () => {
    const query = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: null, error: new Error('simulated dispatch failure') });
    from.mockReturnValue(query);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    dispatchAfterCommit('outbox-1');
    const callback = after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    expect(callback).toEqual(expect.any(Function));
    await callback!();

    expect(logged).toHaveBeenCalledWith('[notifications] post-commit dispatch failed', 'simulated dispatch failure');
  });
});
