import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('request() 網路錯誤 (#959)', () => {
  for (const msg of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    it(`TypeError(${msg}) 轉成中文 ApiError`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(msg)));
      const err = (await request('/api/x').catch((e: unknown) => e)) as ApiError;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toBe('網路連線失敗，請確認網路後再試一次');
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.status).toBeUndefined();
    });
  }

  it('AbortError 原樣丟出', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(request('/api/x')).rejects.toBe(abort);
  });

  it('保留原始錯誤為 cause 並 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(original));
    const err = (await request('/api/x').catch((e: unknown) => e)) as ApiError & { cause?: unknown };
    expect(err.cause).toBe(original);
    expect(warn).toHaveBeenCalled();
  });

  it('signal 已取消且 reason 為自訂值時原樣丟出', async () => {
    const reason = new Error('custom reason');
    const controller = new AbortController();
    controller.abort(reason);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    await expect(request('/api/x', { signal: controller.signal })).rejects.toBe(reason);
  });

  it('正常回應不變', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: true, data: { a: 1 } })));
    await expect(request('/api/x')).resolves.toEqual({ a: 1 });
  });

  it('!res.ok 仍丟出後端 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ success: false, message: '沒權限', code: 'AUTH_005' }, 403)),
    );
    const err = (await request('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: '沒權限', code: 'AUTH_005', status: 403 });
  });

  it('json 解析失敗仍是伺服器回應格式錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json('<html>', 502)));
    const err = (await request('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ message: '伺服器回應格式錯誤', status: 502 });
  });
});
