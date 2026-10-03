/**
 * #754 — 以真實 HTTP 驗證：resend SDK + ResendMockServer + send.ts 分類三者一致。
 * 不 mock resend 套件；SDK 在模組載入時讀 RESEND_BASE_URL，故先設 env 再動態 import。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer } from 'node:net';
import { ResendMockServer } from '../helpers/resend-mock';

const saved = { base: process.env.RESEND_BASE_URL, key: process.env.RESEND_API_KEY };
let mock: ResendMockServer;
let sendVerificationCodeEmail: typeof import('@/server/email/send').sendVerificationCodeEmail;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RESEND_API_KEY = 're_test_unit_real_http';
  mock = new ResendMockServer(port);
  await mock.start();
  vi.resetModules();
  ({ sendVerificationCodeEmail } = await import('@/server/email/send'));
});

afterAll(async () => {
  await mock?.stop();
  if (saved.base === undefined) delete process.env.RESEND_BASE_URL; else process.env.RESEND_BASE_URL = saved.base;
  if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
});

beforeEach(() => {
  mock.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const run = () => sendVerificationCodeEmail('a@example.com', '123456', 'REGISTER');

describe('send.ts 經真實 HTTP + resend SDK 的分類 (#754)', () => {
  it('正常 → SENT，mock 收到一封信', async () => {
    expect(await run()).toEqual({ result: 'SENT', configFailure: false });
    expect(mock.emails).toHaveLength(1);
  });
  it('failNext(401) → FAILED + configFailure=true', async () => {
    mock.failNext(401);
    expect(await run()).toEqual({ result: 'FAILED', configFailure: true });
  });
  it('failNext(403) → FAILED + configFailure=true', async () => {
    mock.failNext(403);
    expect(await run()).toEqual({ result: 'FAILED', configFailure: true });
  });
  it('failNext(500) → FAILED + configFailure=false', async () => {
    mock.failNext(500);
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false });
  });
  it('failNext(429) → FAILED + configFailure=false', async () => {
    mock.failNext(429);
    expect(await run()).toEqual({ result: 'FAILED', configFailure: false });
  });
  it('連不上 provider（mock 關閉）→ FAILED + 暫時性', async () => {
    await mock.stop();
    try {
      expect(await run()).toEqual({ result: 'FAILED', configFailure: false });
    } finally {
      await mock.start();
    }
  });
});
