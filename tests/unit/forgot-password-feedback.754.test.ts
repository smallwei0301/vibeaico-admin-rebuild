import { describe, expect, it, vi } from 'vitest';
import { createForgotPasswordFlow } from '@/lib/forgot-password-flow';
import { readFileSync } from 'node:fs';
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const setup = () => {
  const onState = vi.fn(); const onSuccess = vi.fn(); const onError = vi.fn();
  return { onState, onSuccess, onError, flow: createForgotPasswordFlow({ onState, onSuccess, onError }) };
};
describe('forgot-password current request feedback', () => {
  it('clears previous success before a new request that fails', async () => {
    const h = setup(); await h.flow.submit('a@example.test', async () => {});
    expect(h.onState).toHaveBeenLastCalledWith({ submitting: false, sent: true });
    const failure = new Error('mail unavailable'); await h.flow.submit('a@example.test', async () => { throw failure; });
    expect(h.onState).toHaveBeenLastCalledWith({ submitting: false, sent: false });
    expect(h.onError).toHaveBeenCalledWith(failure);
  });
  it('changing email removes success immediately', async () => {
    const h = setup(); await h.flow.submit('a@example.test', async () => {}); h.flow.reset();
    expect(h.onState).toHaveBeenLastCalledWith({ submitting: false, sent: false });
  });
  it.each(['resolve', 'reject'] as const)('ignores stale %s after email edit', async (settle) => {
    const h = setup(); const old = deferred(); const pending = h.flow.submit('a@example.test', () => old.promise);
    h.flow.reset(); h.onState.mockClear(); old[settle](new Error('old')); await pending;
    expect(h.onState).not.toHaveBeenCalled(); expect(h.onSuccess).not.toHaveBeenCalled(); expect(h.onError).not.toHaveBeenCalled();
  });
  it('old completion cannot clear a newer pending request or overwrite its result', async () => {
    const h = setup(); const old = deferred(); const newer = deferred();
    const first = h.flow.submit('a@example.test', () => old.promise); h.flow.reset();
    const second = h.flow.submit('b@example.test', () => newer.promise); old.resolve(); await first;
    expect(h.onState).toHaveBeenLastCalledWith({ submitting: true, sent: false });
    newer.resolve(); await second; expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onState).toHaveBeenLastCalledWith({ submitting: false, sent: true });
  });
  it('suppresses duplicate submits while current request is pending', async () => {
    const h = setup(); const d = deferred(); const send = vi.fn(() => d.promise);
    const first = h.flow.submit('a@example.test', send); await h.flow.submit('a@example.test', send);
    expect(send).toHaveBeenCalledTimes(1); d.resolve(); await first;
  });
  it('unmount invalidation emits no subsequent state or toast', async () => {
    const h = setup(); const d = deferred(); const pending = h.flow.submit('a@example.test', () => d.promise);
    h.flow.invalidate(); h.onState.mockClear(); d.resolve(); await pending;
    expect(h.onState).not.toHaveBeenCalled(); expect(h.onSuccess).not.toHaveBeenCalled();
  });
  it('actual page wires submit, email edit and cleanup to the controller', () => {
    const page = readFileSync('src/app/tenant/forgot-password/page.tsx', 'utf8');
    expect(page).toContain('flow.current.submit(email.trim(), forgotPassword)');
    expect(page).toContain('flow.current.reset()'); expect(page).toContain('flow.current.invalidate()');
    expect(page).not.toContain('setSent(true)');
  });
});
