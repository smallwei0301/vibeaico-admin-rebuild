import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import { uploadRichMenuBgImage } from '@/services/settings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/rich-menu-design/page.tsx');
const service = read('src/services/settings.ts');

describe('rich-menu 背景圖上傳按鈕 — 真的接線而非死按鈕 (#7)', () => {
  it('上傳圖片按鈕不再是沒有 onClick 的死按鈕，會觸發隱藏的檔案選取', () => {
    // 反向鎖住舊的死按鈕寫法：<Button variant="outline"><Upload .../>{t.background.uploadImage}</Button>
    expect(page).not.toContain('<Button variant="outline"><Upload size={14} />{t.background.uploadImage}</Button>');
    expect(page).toContain('onClick={() => bgFileInputRef.current?.click()}');
    expect(page).toContain('type="file"');
    expect(page).toContain('accept="image/jpeg,image/png"');
  });

  it('選檔後呼叫 uploadRichMenuBgImage service，成功後把 url 填進 bgUrl', () => {
    expect(page).toContain("uploadRichMenuBgImage } from '@/services/settings'");
    const handler = page.slice(
      page.indexOf('const handleBgFileChange'),
      page.indexOf('return (', page.indexOf('const handleBgFileChange')),
    );
    expect(handler).toContain('await uploadRichMenuBgImage(file)');
    expect(handler).toContain('setBgUrl(url)');
  });

  it('上傳中有 loading 狀態（按鈕 disabled）', () => {
    expect(page).toContain('const [bgUploading, setBgUploading] = React.useState(false);');
    expect(page).toContain('loading={bgUploading}');
    expect(page).toContain('setBgUploading(true)');
    expect(page).toContain('setBgUploading(false)');
  });

  it('失敗時 toast 顯示後端回傳的真實訊息，而非自己編的字串', () => {
    const handler = page.slice(
      page.indexOf('const handleBgFileChange'),
      page.indexOf('return (', page.indexOf('const handleBgFileChange')),
    );
    expect(handler).toContain('err instanceof ApiError ? err.message : t.messages.unknownError');
  });
});

describe('src/services/settings.ts — uploadRichMenuBgImage 走專用端點，不是通用 /api/upload (#7)', () => {
  it('real 分支打的是專用端點，不是通用上傳端點', () => {
    const fn = service.slice(service.indexOf('export const uploadRichMenuBgImage'));
    expect(fn).toContain("'/api/settings/line/rich-menu/upload-bg-image'");
    expect(fn).not.toContain("'/api/upload'");
  });

  it('不得引用 rich-menu 的 create／發布端點', () => {
    expect(service).not.toContain('/api/settings/line/rich-menu/create');
  });

  it('mock 分支（NEXT_PUBLIC_USE_MOCK 預設 true）— 正常檔案回傳 { url: file.name }，比照既有 uploadImage() 慣例', async () => {
    const file = new File([new Uint8Array(1024)], 'bg.png', { type: 'image/png' });
    const result = await uploadRichMenuBgImage(file);
    expect(result).toEqual({ url: 'bg.png' });
  });

  it('mock 分支對超過 1MB 的圖片拋出與後端專用端點對等的錯誤', async () => {
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(uploadRichMenuBgImage(oversized)).rejects.toThrow(
      '圖片超過 1MB 上限（LINE Rich Menu 限制），請壓縮後再上傳',
    );
    await expect(uploadRichMenuBgImage(oversized)).rejects.toBeInstanceOf(ApiError);
  });

  it('mock 分支對非 JPEG/PNG 格式拋出與後端專用端點對等的錯誤', async () => {
    const wrongType = new File([new Uint8Array(10)], 'bg.gif', { type: 'image/gif' });
    await expect(uploadRichMenuBgImage(wrongType)).rejects.toThrow('僅支援 JPEG / PNG 圖片');
  });

  it('mock 分支比通用 uploadImage() 更嚴格 —— mock 模式不能比 real 模式寬鬆', async () => {
    // 通用 uploadImage() 的 mock 分支對任何檔案一律回傳 { url: file.name }，沒有大小/格式檢查；
    // rich-menu 專用上傳若沿用同一套寬鬆 mock，會讓示範模式看到成功、真實模式卻失敗。
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(uploadRichMenuBgImage(oversized)).rejects.toThrow(ApiError);
  });
});
