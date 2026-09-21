/**
 * tests/unit/public-cors.11.test.ts — `/api/public/**` 的跨網域授權（issue #11 §4.1）
 * -----------------------------------------------------------------------------
 * `src/server/public-cors.ts` 是全站第一個刻意允許跨網域呼叫的授權層。直接測試
 * 真正的行為（呼叫 `publicCorsHeaders()`/`publicCorsPreflightResponse()`），
 * 不是讀原始碼字串——CORS 的正確性完全體現在「這個 origin 有沒有拿到
 * `Access-Control-Allow-Origin`」這個行為上，字串比對驗不到這件事。
 *
 * `src/config/env.ts` 的 `serverEnv` 在模組載入時就把 `process.env` 解析一次
 * （zod schema），所以每個 case 都用 `vi.stubEnv` + `vi.resetModules()` +
 * 動態 `import()` 取得反映當下環境變數的全新模組實例，避免前一個 case 的
 * `PUBLIC_CORS_ORIGINS` 殘留到下一個 case。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshCorsModule() {
  vi.resetModules();
  return import('@/server/public-cors');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('#11 publicCorsHeaders — 白名單 origin 才拿到 ACAO', () => {
  it('白名單內的 origin：帶 Access-Control-Allow-Origin，且值等於該 origin（不是 *）', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw,https://preview.midao.com.tw');
    const { publicCorsHeaders } = await freshCorsModule();

    const headers = publicCorsHeaders('https://midao.com.tw');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://midao.com.tw');
    expect(headers.Vary).toBe('Origin');
  });

  it('不在白名單的 origin：完全不帶 Access-Control-Allow-Origin（不是回一個「拒絕」的值）', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw');
    const { publicCorsHeaders } = await freshCorsModule();

    const headers = publicCorsHeaders('https://evil.example.com');
    expect('Access-Control-Allow-Origin' in headers).toBe(false);
    expect(headers.Vary).toBe('Origin');
  });

  it('子網域不會被誤判為命中：不支援萬用字元比對', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw');
    const { publicCorsHeaders } = await freshCorsModule();

    const headers = publicCorsHeaders('https://attacker.midao.com.tw');
    expect('Access-Control-Allow-Origin' in headers).toBe(false);
  });

  it('沒有 Origin header（同源請求）：不帶 ACAO，也不會因此丟錯', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw');
    const { publicCorsHeaders } = await freshCorsModule();

    const headers = publicCorsHeaders(null);
    expect('Access-Control-Allow-Origin' in headers).toBe(false);
  });

  it('PUBLIC_CORS_ORIGINS 未設定：fail closed，任何 origin 都拿不到 ACAO', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', '');
    const { publicCorsHeaders } = await freshCorsModule();

    const headers = publicCorsHeaders('https://midao.com.tw');
    expect('Access-Control-Allow-Origin' in headers).toBe(false);
  });
});

describe('#11 publicCorsPreflightResponse — OPTIONS preflight', () => {
  it('白名單 origin：204 且帶完整 preflight header 組合', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw');
    const { publicCorsPreflightResponse } = await freshCorsModule();

    const res = publicCorsPreflightResponse('https://midao.com.tw');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://midao.com.tw');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBeTruthy();
  });

  it('非白名單 origin：仍回 204，但沒有 Access-Control-Allow-Origin（瀏覽器仍會擋下正式請求）', async () => {
    vi.stubEnv('PUBLIC_CORS_ORIGINS', 'https://midao.com.tw');
    const { publicCorsPreflightResponse } = await freshCorsModule();

    const res = publicCorsPreflightResponse('https://evil.example.com');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
