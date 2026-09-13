import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response() {
  return new Response(JSON.stringify({ success: true, data: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API request content type', () => {
  it('leaves the Content-Type header unset for FormData bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('file', new File(['image'], 'image.png', { type: 'image/png' }));

    await request('/api/upload', { method: 'POST', body: form });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('keeps the JSON default for ordinary request bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);

    await request('/api/settings', { method: 'PUT', body: JSON.stringify({}) });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toHaveProperty('Content-Type', 'application/json');
  });
});
