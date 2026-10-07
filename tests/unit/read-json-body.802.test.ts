/**
 * #802 — 匿名端點 request body 上限：`readJsonBody()` 與 send-verification-code 接線。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dispatch = vi.fn();
vi.mock('@/server/send-code', () => ({ dispatchVerificationCode: (...a: unknown[]) => dispatch(...a) }));

// handle() 對寫入型請求會先看代登入 cookie；單元環境沒有 request scope，給一個空 cookie jar。
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import {
  readJsonBody, readOptionalJsonBody, ApiHttpError, ERR, PUBLIC_JSON_BODY_LIMIT_BYTES,
} from '@/server/http';
import { POST as sendCode } from '@/app/api/auth/send-verification-code/route';

const requireUser = vi.fn();
vi.mock('@/server/tenant', () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
  ACTIVE_TENANT_COOKIE: 'vibeai_active_tenant',
}));

import { POST as switchTenant } from '@/app/api/auth/switch-tenant/route';
import { POST as changePassword } from '@/app/api/auth/change-password/route';

const enc = new TextEncoder();

/** 串流 body，可記錄是否被讀取／取消；不帶 content-length（除非 headers 指定）。 */
function streamReq(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const state = { pulled: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) { state.pulled++; c.enqueue(chunks[i++]); } else c.close();
    },
    cancel() { state.cancelled = true; },
  });
  const req = new Request('http://localhost/x', {
    method: 'POST', body, headers, duplex: 'half',
  } as RequestInit);
  return { req, state };
}

async function catch413(p: Promise<unknown>) {
  try { await p; } catch (e) { return e as ApiHttpError; }
  throw new Error('expected rejection');
}

describe('readJsonBody (#802)', () => {
  it('上限常數為 16 KB', () => {
    expect(PUBLIC_JSON_BODY_LIMIT_BYTES).toBe(16 * 1024);
  });

  it('未超限正常解析', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    await expect(readJsonBody(req, 1024)).resolves.toEqual({ a: 1 });
  });

  it('多 chunk 串流正常解析（含多位元組字元跨 chunk）', async () => {
    const bytes = enc.encode(JSON.stringify({ n: '中文' }));
    const { req } = streamReq([bytes.slice(0, 9), bytes.slice(9)]);
    await expect(readJsonBody(req, 1024)).resolves.toEqual({ n: '中文' });
  });

  it('content-length 超限回 413 REQ_005，且完全不碰 body', async () => {
    // 用假 request：任何對 body／json() 的存取都會被記錄（真 Request 建構時會預先 pull 一次，無法證明）。
    const touched = vi.fn();
    const req = {
      headers: new Headers({ 'content-length': '2048' }),
      get body() { touched('body'); return null; },
      json: () => { touched('json'); return Promise.resolve({}); },
    } as unknown as Request;
    const e = await catch413(readJsonBody(req, 1024));
    expect(e).toBeInstanceOf(ApiHttpError);
    expect(e.status).toBe(413);
    expect(e.code).toBe(ERR.PAYLOAD_TOO_LARGE);
    expect(touched).not.toHaveBeenCalled();
  });

  it('content-length 缺失但串流超限回 413 並 cancel', async () => {
    const big = enc.encode('x'.repeat(600));
    const { req, state } = streamReq([big, big, big, big]);
    expect(req.headers.get('content-length')).toBeNull();
    const e = await catch413(readJsonBody(req, 1024));
    expect(e.status).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(4);
  });

  it('content-length 謊報（宣稱小、實際大）回 413', async () => {
    const big = enc.encode('x'.repeat(600));
    const { req, state } = streamReq([big, big, big], { 'content-length': '10' });
    const e = await catch413(readJsonBody(req, 1024));
    expect(e.status).toBe(413);
    expect(state.cancelled).toBe(true);
  });

  it('格式錯誤丟 ApiHttpError 400 REQ_001（#804）', async () => {
    const e = (await readJsonBody(new Request('http://localhost/x', { method: 'POST', body: '{bad' }), 1024).catch((x) => x)) as ApiHttpError;
    expect(e).toBeInstanceOf(ApiHttpError);
    expect(e.status).toBe(400);
    expect(e.code).toBe(ERR.VALIDATION);
    expect(e.code).toBe('REQ_001');
  });

  it('空 body 丟 ApiHttpError 400 REQ_001（#804）', async () => {
    const e = (await readJsonBody(new Request('http://localhost/x', { method: 'POST', body: '' }), 1024).catch((x) => x)) as ApiHttpError;
    expect(e).toBeInstanceOf(ApiHttpError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('REQ_001');
  });

  it('無 body（req.body 為 null）丟 400 REQ_001，且不呼叫 req.json()', async () => {
    const json = vi.fn();
    const req = { headers: new Headers(), body: null, json } as unknown as Request;
    const e = (await readJsonBody(req, 1024).catch((x) => x)) as ApiHttpError;
    expect(e).toBeInstanceOf(ApiHttpError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('REQ_001');
    expect(json).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/send-verification-code 格式錯誤 body (#804)', () => {
  beforeEach(() => { dispatch.mockReset(); });

  it.each([
    ['格式錯誤', '{bad'],
    ['空 body', ''],
  ])('%s 回 400 REQ_001 信封，且不呼叫下游', async (_n, body) => {
    const res = await sendCode(new Request('http://localhost/api/auth/send-verification-code', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, message: '輸入格式錯誤', code: 'REQ_001' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('無 body 回 400 REQ_001，且不呼叫下游', async () => {
    const res = await sendCode(new Request('http://localhost/api/auth/send-verification-code', { method: 'POST' }), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('REQ_001');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/send-verification-code body 上限 (#802)', () => {
  beforeEach(() => { dispatch.mockReset(); });

  it('超限回 413 信封，且不呼叫下游', async () => {
    const pad = 'a'.repeat(PUBLIC_JSON_BODY_LIMIT_BYTES + 1);
    const body = JSON.stringify({ email: 'a@b.co', purpose: 'REGISTER', pad });
    const res = await sendCode(new Request('http://localhost/api/auth/send-verification-code', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), {});
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ success: false, message: '請求內容過大', code: ERR.PAYLOAD_TOO_LARGE });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('未超限仍正常呼叫下游', async () => {
    dispatch.mockResolvedValue(undefined);
    const res = await sendCode(new Request('http://localhost/api/auth/send-verification-code', {
      method: 'POST', body: JSON.stringify({ email: 'a@b.co', purpose: 'REGISTER' }),
    }), {});
    expect(res.status).toBe(200);
    expect(dispatch).toHaveBeenCalledWith('a@b.co', 'REGISTER');
  });
});

describe('POST /api/auth/switch-tenant body 上限 (#802)', () => {
  beforeEach(() => { requireUser.mockReset(); });

  it('超限回 413 信封，且未呼叫 requireUser／下游', async () => {
    const pad = 'a'.repeat(PUBLIC_JSON_BODY_LIMIT_BYTES + 1);
    const body = JSON.stringify({ tenantId: '00000000-0000-4000-8000-000000000000', pad });
    const res = await switchTenant(new Request('http://localhost/api/auth/switch-tenant', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), {});
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ success: false, message: '請求內容過大', code: ERR.PAYLOAD_TOO_LARGE });
    expect(requireUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/change-password body 上限 (#802)', () => {
  beforeEach(() => { requireUser.mockReset(); });

  it('超限回 413 信封，且未呼叫 requireUser／下游', async () => {
    const pad = 'a'.repeat(PUBLIC_JSON_BODY_LIMIT_BYTES + 1);
    const body = JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password-1', pad });
    const res = await changePassword(new Request('http://localhost/api/auth/change-password', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), {});
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ success: false, message: '請求內容過大', code: ERR.PAYLOAD_TOO_LARGE });
    expect(requireUser).not.toHaveBeenCalled();
  });
});

describe('readOptionalJsonBody（#816 Codex P2）', () => {
  it('無 body／空 body／空白字串 → undefined', async () => {
    await expect(readOptionalJsonBody(new Request('http://localhost/x', { method: 'POST' }), 1024)).resolves.toBeUndefined();
    await expect(readOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '' }), 1024)).resolves.toBeUndefined();
    await expect(readOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: ' \n\t ' }), 1024)).resolves.toBeUndefined();
  });

  it('合法 JSON 正常解析', async () => {
    await expect(readOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '{"a":1}' }), 1024))
      .resolves.toEqual({ a: 1 });
  });

  it('壞 JSON → 400 REQ_001', async () => {
    await expect(readOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '{bad' }), 1024))
      .rejects.toMatchObject({ status: 400, code: ERR.VALIDATION });
  });

  it('content-length 超限 → 413，不讀 body', async () => {
    const { req, state } = streamReq([enc.encode('{}')], { 'content-length': '2048' });
    const e = await catch413(readOptionalJsonBody(req, 1024));
    expect(e.status).toBe(413);
    expect(state.pulled).toBeLessThanOrEqual(1); // ReadableStream 建構時預拉一塊；預檢不再讀取
  });

  it('無 content-length 但串流超限（多位元組字元：字元數 < 上限、位元組 > 上限）→ 413 並 cancel', async () => {
    const text = '"' + '中'.repeat(400) + '"'; // 402 字元、1202 bytes
    expect(text.length).toBeLessThan(1024);
    const { req, state } = streamReq([enc.encode(text)]);
    const e = await catch413(readOptionalJsonBody(req, 1024));
    expect(e.status).toBe(413);
    expect(e.code).toBe(ERR.PAYLOAD_TOO_LARGE);
    expect(state.cancelled).toBe(true);
  });

  it('readJsonBody 行為不變：空 body／無 body／空白 → 400', async () => {
    await expect(readJsonBody(new Request('http://localhost/x', { method: 'POST' }), 1024)).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(new Request('http://localhost/x', { method: 'POST', body: '' }), 1024)).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(new Request('http://localhost/x', { method: 'POST', body: '  ' }), 1024)).rejects.toMatchObject({ status: 400 });
  });
});
