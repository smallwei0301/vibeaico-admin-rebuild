/**
 * #802 — 匿名端點 request body 上限：`readJsonBody()` 與 send-verification-code 接線。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dispatch = vi.fn();
vi.mock('@/server/send-code', () => ({ dispatchVerificationCode: (...a: unknown[]) => dispatch(...a) }));

// handle() 對寫入型請求會先看代登入 cookie；單元環境沒有 request scope，給一個空 cookie jar。
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import {
  readJsonBody, ApiHttpError, ERR, PUBLIC_JSON_BODY_LIMIT_BYTES,
} from '@/server/http';
import { POST as sendCode } from '@/app/api/auth/send-verification-code/route';

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

  it('格式錯誤與原本 req.json() 相同（SyntaxError，由 handle() 處理）', async () => {
    const mk = () => new Request('http://localhost/x', { method: 'POST', body: '{bad' });
    const orig = await mk().json().catch((e) => e);
    const got = await readJsonBody(mk(), 1024).catch((e) => e);
    expect(orig).toBeInstanceOf(SyntaxError);
    expect(got).toBeInstanceOf(SyntaxError);
    expect(got).not.toBeInstanceOf(ApiHttpError);
  });

  it('空 body 與原本 req.json() 相同（SyntaxError）', async () => {
    const mk = () => new Request('http://localhost/x', { method: 'POST' });
    const orig = await mk().json().catch((e) => e);
    const got = await readJsonBody(mk(), 1024).catch((e) => e);
    expect(orig).toBeInstanceOf(SyntaxError);
    expect(got).toBeInstanceOf(SyntaxError);
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
