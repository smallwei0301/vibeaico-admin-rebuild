/** #754 — send.ts 將 Resend 結果分成 SENT / FAILED / SKIPPED_NO_KEY，並區分設定類與暫時性失敗。 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));

import { sendVerificationCodeEmail } from '@/server/email/send';

const OLD = process.env.RESEND_API_KEY;
beforeEach(() => {
  resendSend.mockReset();
  process.env.RESEND_API_KEY = 're_x';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); if (OLD === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = OLD; });

const run = () => sendVerificationCodeEmail('a@example.com', '123456', 'REGISTER');

describe('sendVerificationCodeEmail 結果分類 (#754)', () => {
  it('成功 → SENT', async () => {
    resendSend.mockResolvedValue({ data: { id: '1' }, error: null });
    expect(await run()).toEqual({ result: 'SENT', configFailure: false });
  });
  it('401 API key invalid → FAILED + 設定類', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'API key is invalid', statusCode: 401 } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: true });
  });
  it('403 網域未驗證 → 設定類', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'The x.com domain is not verified', statusCode: 403 } });
    expect((await run()).configFailure).toBe(true);
  });
  it('500 → FAILED + 暫時性', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'boom', statusCode: 500 } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false });
  });
  it('丟出例外 → FAILED + 暫時性', async () => {
    resendSend.mockRejectedValue(new Error('network'));
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false });
  });
  it('無 key → SKIPPED_NO_KEY，不呼叫 Resend', async () => {
    delete process.env.RESEND_API_KEY;
    expect(await run()).toEqual({ result: 'SKIPPED_NO_KEY', configFailure: true });
    expect(resendSend).not.toHaveBeenCalled();
  });
});
