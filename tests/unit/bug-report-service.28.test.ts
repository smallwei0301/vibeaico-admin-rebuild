import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildBugReportRequestBody,
  submitBugReport,
} from '@/services/bug-report';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bug-report service: current endpoint contract', () => {
  it('keeps all collected values in the existing content field', () => {
    expect(buildBugReportRequestBody({
      category: 'DISPLAY',
      subject: '按鈕沒有反應',
      content: '點擊儲存後沒有任何變化',
      contactEmail: 'owner@example.test',
      pageUrl: 'https://example.test/tenant/services',
    })).toEqual({
      category: 'DISPLAY',
      content: 'Subject: 按鈕沒有反應\n\nDescription:\n點擊儲存後沒有任何變化\n\nContact email: owner@example.test',
      pageUrl: 'https://example.test/tenant/services',
    });
  });

  it('posts only the real route contract and requires a returned id', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        category: 'BUG',
        content: 'Subject: 標題\n\nDescription:\n內容',
      });
      return new Response(JSON.stringify({ success: true, data: { id: 'report-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitBugReport({
      category: 'BUG',
      subject: '標題',
      content: '內容',
    })).resolves.toEqual({ id: 'report-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/bug-report', expect.any(Object));

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    await expect(submitBugReport({
      subject: '標題',
      content: '內容',
    })).rejects.toThrow('伺服器未確認回報已建立');
  });
});
