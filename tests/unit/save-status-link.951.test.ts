import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildCopyUrl, copyStatusLink } from '@/lib/save-status-link';
import { SaveStatusLink } from '@/components/public/SaveStatusLink';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';

describe('#951 buildCopyUrl', () => {
  it('移除 created，保留路徑與 contact 等其他參數', () => {
    expect(buildCopyUrl('https://x.test/s/abc/requests/o1?contact=a%40b.c&created=1')).toBe(
      'https://x.test/s/abc/requests/o1?contact=a%40b.c',
    );
    expect(buildCopyUrl('https://x.test/s/abc/requests/o1?created=1&contact=0912&x=2')).toBe(
      'https://x.test/s/abc/requests/o1?contact=0912&x=2',
    );
  });
  it('沒有 created 時不變；無法解析時原樣返回', () => {
    expect(buildCopyUrl('https://x.test/s/a/requests/o?contact=1')).toBe('https://x.test/s/a/requests/o?contact=1');
    expect(buildCopyUrl('not a url')).toBe('not a url');
  });
});

describe('#951 copyStatusLink', () => {
  it('成功寫入去除 created 的網址', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyStatusLink('https://x.test/p?contact=1&created=1', { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.test/p?contact=1');
  });
  it('寫入被拒或無 clipboard 皆回報 failed', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    await expect(copyStatusLink('https://x.test/p', { writeText })).resolves.toBe('failed');
    await expect(copyStatusLink('https://x.test/p', undefined)).resolves.toBe('failed');
  });
});

describe('#951 SaveStatusLink 渲染與頁面接線', () => {
  it('醒目與一般兩種樣式都顯示提示與按鈕，初始無回饋文字', () => {
    for (const prominent of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(SaveStatusLink, { prominent }));
      expect(html).toContain(t.status.saveLink.hint);
      expect(html).toContain(t.status.saveLink.copy);
      expect(html).toContain('aria-live="polite"');
      expect(html).not.toContain(t.status.saveLink.copied);
    }
    expect(renderToStaticMarkup(React.createElement(SaveStatusLink, { prominent: true }))).toContain('border-primary');
  });
  it('頁面只在存取檢查（notFound）之後才渲染元件，且不傳入訂單或聯絡方式', () => {
    const src = readFileSync('src/app/s/[shopCode]/requests/[orderId]/page.tsx', 'utf8');
    const guard = src.indexOf('if (!order) notFound();');
    const first = src.indexOf('<SaveStatusLink');
    expect(guard).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(guard);
    for (const m of src.match(/<SaveStatusLink[^>]*>/g) ?? []) {
      expect(m).not.toMatch(/order|contact/);
    }
    expect(readFileSync('src/components/public/SaveStatusLink.tsx', 'utf8').startsWith("'use client';")).toBe(true);
  });
});
