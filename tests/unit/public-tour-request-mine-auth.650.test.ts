import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('issue #650 — 我的訂單匿名批次查詢 fail closed', () => {
  it('舊匿名 API 直接要求旅客身分，不再用 contact loader 回傳訂單', () => {
    const source = read('src/app/api/public/tour-requests/mine/route.ts');

    expect(source).toContain("fail(401");
    expect(source).toContain('ERR.UNAUTHORIZED');
    expect(source).not.toContain("loadPublicTourOrdersByContact");
    expect(source).not.toContain('body.contact');
    expect(source).not.toContain('checkRateLimit');
  });

  it('公開頁不再收集或送出聯絡方式做批次查單', () => {
    const source = read('src/app/s/[shopCode]/my-orders/MyOrdersSearch.tsx');

    expect(source).toContain('ShieldCheck');
    expect(source).not.toContain('/api/public/tour-requests/mine');
    expect(source).not.toContain('JSON.stringify({ shopCode, contact');
    expect(source).not.toContain('contactLabel');
  });

  it('使用者文案明確說明需要身分驗證，而不是暗示聯絡方式等於本人', () => {
    const source = read('src/i18n/zh-TW/pages/public-tour-request.ts');

    expect(source).toContain('查詢所有訂單需要先完成旅客身分驗證');
    expect(source).toContain('不再接受只輸入電話、LINE ID 或 Email 的匿名批次查詢');
    expect(source).not.toContain('輸入您申請時填寫的電話、LINE ID 或 Email 其中一種，即可查詢');
  });
});
