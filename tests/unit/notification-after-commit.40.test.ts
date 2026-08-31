import { beforeEach, describe, expect, it, vi } from 'vitest';

const after = vi.fn();

vi.mock('next/server', () => ({ after }));

const { dispatchAfterCommit } = await import('@/server/notifications/outbox');

describe('post-commit notification dispatch (#40, 17 §2)', () => {
  beforeEach(() => after.mockReset());

  it('registers work with Next after() so it outlives the completed route response', () => {
    dispatchAfterCommit('outbox-1');
    expect(after).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledWith(expect.any(Function));
  });
});
