import { describe, it, expect, vi, afterEach } from 'vitest';
import { ERR, ok, fail, ApiHttpError, handle } from '@/server/http';

describe('http — ok (01 §5.1)', () => {
  it('帶 data：回 { success: true, data }，status 200', async () => {
    const res = ok({ foo: 'bar' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { foo: 'bar' } });
  });

  it('不帶 data：data 為 undefined', async () => {
    const res = ok();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeUndefined();
  });
});

describe('http — fail (01 §5.1)', () => {
  it('回 { success: false, message, code } 且 status 正確', async () => {
    const res = fail(403, '權限不足', ERR.FORBIDDEN);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: '權限不足', code: 'AUTH_005' });
  });

  it('不帶 code 時 code 為 undefined', async () => {
    const res = fail(404, '找不到資源');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('找不到資源');
    expect(body.code).toBeUndefined();
  });
});

describe('http — handle (01 §5.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正常回傳 → 原樣回傳', async () => {
    const inner = handle(async () => ok({ hello: 'world' }));
    const res = await inner(new Request('http://localhost/api/x'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { hello: 'world' } });
  });

  it('丟 ApiHttpError(403, ...) → 回 403 且 code 是 AUTH_005', async () => {
    const inner = handle(async () => {
      throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
    });
    const res = await inner(new Request('http://localhost/api/x'), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('權限不足');
    expect(body.code).toBe('AUTH_005');
  });

  it('丟 ZodError → 回 400 且 code 是 REQ_001，訊息取 issues[0].message', async () => {
    const zodError: any = new Error('Invalid input');
    zodError.name = 'ZodError';
    zodError.issues = [{ message: '欄位為必填' }];
    const inner = handle(async () => {
      throw zodError;
    });
    const res = await inner(new Request('http://localhost/api/x'), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('欄位為必填');
    expect(body.code).toBe('REQ_001');
  });

  it('ZodError 但 issues 是空陣列 → 用預設訊息「輸入格式錯誤」', async () => {
    const zodError: any = new Error('Invalid input');
    zodError.name = 'ZodError';
    zodError.issues = [];
    const inner = handle(async () => {
      throw zodError;
    });
    const res = await inner(new Request('http://localhost/api/x'), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('輸入格式錯誤');
    expect(body.code).toBe('REQ_001');
  });

  it('丟其他錯誤 → 回 500 且 code 是 SYS_001（並 console.error 一次）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const inner = handle(async () => {
      throw new Error('boom');
    });
    const res = await inner(new Request('http://localhost/api/x', { method: 'POST' }), {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('系統發生錯誤，請稍後再試');
    expect(body.code).toBe('SYS_001');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[api]', 'POST', '/api/x', expect.any(Error));
  });
});
