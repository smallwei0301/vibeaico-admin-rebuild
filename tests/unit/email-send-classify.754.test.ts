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
    expect(await run()).toEqual({ result: 'SENT', configFailure: false, failureKind: null });
  });
  it('401 API key invalid → FAILED + 設定類', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'API key is invalid', statusCode: 401 } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: true, failureKind: 'config' });
  });
  it('403 網域未驗證 → 設定類', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'The x.com domain is not verified', statusCode: 403 } });
    expect((await run()).configFailure).toBe(true);
  });
  it('500 → FAILED + 暫時性', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'boom', statusCode: 500 } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false, failureKind: 'service' });
  });
  it('丟出例外 → FAILED + 暫時性', async () => {
    resendSend.mockRejectedValue(new Error('network'));
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false, failureKind: 'service' });
  });
  it('無 key → SKIPPED_NO_KEY，不呼叫 Resend', async () => {
    delete process.env.RESEND_API_KEY;
    expect(await run()).toEqual({ result: 'SKIPPED_NO_KEY', configFailure: true, failureKind: 'config' });
    expect(resendSend).not.toHaveBeenCalled();
  });

  const FROM_422 = 'Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.';
  it.each([
    [422, 'validation_error', 'Invalid `to` field. The email address needs to follow the `email@example.com` format.'],
    [400, 'validation_error', 'Invalid `to` field.'],
  ])('%i 且 message 指涉 to 欄位 → recipient（#763）', async (statusCode, name, message) => {
    resendSend.mockResolvedValue({ data: null, error: { name, message, statusCode } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false, failureKind: 'recipient' });
  });
  it('422 validation_error 且 message 指涉 from 欄位（MAIL_FROM 格式錯誤）→ config', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: FROM_422, statusCode: 422 } });
    expect(await run()).toEqual({ result: 'FAILED', configFailure: true, failureKind: 'config' });
  });
  it('400 無 to 指涉（Missing `subject` field）→ config（fail-closed）', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'missing_required_field', message: 'Missing `subject` field.', statusCode: 400 } });
    expect((await run()).failureKind).toBe('config');
  });
  it.each([[422, 'validation_error'], [404, 'not_found'], [409, 'invalid_idempotent_request']])(
    '%i 泛用訊息（不含 to 指涉）→ config（fail-closed）', async (statusCode, name) => {
      resendSend.mockResolvedValue({ data: null, error: { name, message: 'Something is wrong with the request', statusCode } });
      expect(await run()).toEqual({ result: 'FAILED', configFailure: true, failureKind: 'config' });
    });
  it.each([429, 500, 502, 503])('%i → service', async (statusCode) => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'x', statusCode } });
    expect((await run()).failureKind).toBe('service');
  });
  it('SDK 網路錯誤（statusCode null）→ service', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'Unable to fetch data', statusCode: null } });
    expect((await run()).failureKind).toBe('service');
  });
  it.each(['missing_api_key', 'invalid_api_key', 'restricted_api_key', 'invalid_from_address'])('%s（即使 4xx）→ config', async (name) => {
    resendSend.mockResolvedValue({ data: null, error: { name, message: 'x', statusCode: 422 } });
    expect((await run()).failureKind).toBe('config');
  });
});
