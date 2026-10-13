import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_IMAGE_BUCKET,
  canManageMarketing,
  validateMessageImageFile,
} from '@/lib/message-image';
import { marketingPage } from '@/i18n/zh-TW/pages/marketing';
import { campaignsPage } from '@/i18n/zh-TW/pages/campaigns';

const MB = 1024 * 1024;
const pages = {
  marketing: readFileSync('src/app/tenant/marketing/page.tsx', 'utf8'),
  campaigns: readFileSync('src/app/tenant/campaigns/page.tsx', 'utf8'),
};

describe('行銷推播／活動圖片：驗證 helper', () => {
  it('只接受 jpeg/png/webp 且 ≤5MB（與 /api/upload 一致）', () => {
    expect(validateMessageImageFile({ type: 'image/png', size: 5 * MB })).toBeNull();
    expect(validateMessageImageFile({ type: 'image/jpeg', size: 1 })).toBeNull();
    expect(validateMessageImageFile({ type: 'image/webp', size: 1 })).toBeNull();
    expect(validateMessageImageFile({ type: 'image/png', size: 5 * MB + 1 })).toBe('size');
    expect(validateMessageImageFile({ type: 'image/gif', size: 1 })).toBe('type');
    expect(validateMessageImageFile({ type: 'application/pdf', size: 1 })).toBe('type');
  });
  it('只有 OWNER／MANAGER 可管理，STAFF／未知角色不可', () => {
    expect(canManageMarketing('OWNER')).toBe(true);
    expect(canManageMarketing('MANAGER')).toBe(true);
    expect(canManageMarketing('STAFF')).toBe(false);
    expect(canManageMarketing(null)).toBe(false);
    expect(canManageMarketing(undefined)).toBe(false);
  });
  it('使用既有的 keyword-reply-images bucket', () => {
    expect(MESSAGE_IMAGE_BUCKET).toBe('keyword-reply-images');
    const upload = readFileSync('src/app/api/upload/route.ts', 'utf8');
    expect(upload).toContain("'keyword-reply-images'");
    expect(readFileSync('src/lib/message-image.ts', 'utf8')).toContain('uploadImage(file, MESSAGE_IMAGE_BUCKET)');
  });
});

describe.each(Object.entries(pages))('%s 頁面圖片上傳接線', (_name, src) => {
  it('pickImage 對 STAFF 在驗證與上傳前早退', () => {
    expect(src).toMatch(/if \(!file \|\| !canUploadImage \|\| uploading \|\| saving\) return;/);
    expect(src.indexOf('!canUploadImage || uploading')).toBeLessThan(src.indexOf('await uploadMessageImage(file)'));
    expect(src).toMatch(/disabled=\{!canUploadImage \|\| uploading \|\| saving\}/);
    expect(src).toContain('t.form.imageStaffReadonly');
  });
  it('先驗證再上傳，成功才設定 imageUrl，失敗顯示錯誤且不改值', () => {
    expect(src).toContain('validateMessageImageFile(file)');
    expect(src).toContain('const url = await uploadMessageImage(file);\n      if (token !== uploadTokenRef.current) return;\n      setImageUrl(url);');
    expect(src).toContain("toast.show(msg, 'danger')");
    // catch 區塊內不得 setImageUrl（失敗保留原值）
    const catchBlock = src.slice(src.indexOf('} catch (err) {'), src.indexOf('} finally {', src.indexOf('} catch (err) {')));
    expect(catchBlock).not.toContain('setImageUrl');
  });
  it('不再只記檔名（無假成功），上傳中禁止儲存，input 可重選同檔', () => {
    expect(src).not.toContain('setImageName');
    expect(src).not.toContain('imageName');
    expect(src).toMatch(/disabled=\{uploading\} onClick=\{\(\) => void submit\(\)\}/);
    expect(src).toContain("input.value = '';");
  });
});

describe('payload 帶入新圖片', () => {
  it('推播 payload 使用 imageUrl state', () => {
    expect(pages.marketing).toContain('imageUrl: imageUrl.trim(),');
  });
  it('活動 payload 使用 imageUrl state，不再沿用舊值', () => {
    expect(pages.campaigns).toMatch(/isAutoTrigger,\n\s+imageUrl,\n/);
    expect(pages.campaigns).not.toMatch(/imageUrl: campaign\?\.imageUrl/);
  });
  it('活動圖片隨 content jsonb 往返（API 合併 content、mapper 讀回）', () => {
    const svc = readFileSync('src/services/campaigns.ts', 'utf8');
    expect(svc).toContain('imageUrl: p.imageUrl,');
    expect(svc).toContain("imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : ''");
    expect(svc).toContain('item.imageUrl = payload.imageUrl;');
    expect(readFileSync('src/services/marketing.ts', 'utf8')).toContain('item.imageUrl = payload.imageUrl;');
  });
});

describe('文案反映真實限制', () => {
  it('不再宣稱 2MB 或「上傳圖片優先」', () => {
    const all = JSON.stringify([marketingPage, campaignsPage]);
    expect(all).not.toContain('2MB');
    expect(all).not.toContain('上傳圖片優先');
    expect(marketingPage.messages.imageTooLarge).toContain('5MB');
    expect(campaignsPage.messages.imageTooLarge).toContain('5MB');
  });
});

describe('表單元件上傳競態守衛（push／campaign）', () => {
  for (const file of ['src/app/tenant/marketing/page.tsx', 'src/app/tenant/campaigns/page.tsx']) {
    it(`${file} 以 token 丟棄過期的上傳結果，且預覽只渲染可渲染網址`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('uploadTokenRef');
      expect(src).toMatch(/const token = \+\+uploadTokenRef\.current;/);
      expect(src).toMatch(/if \(token !== uploadTokenRef\.current\) return;/);
      expect(src).toContain('imageUrl && isRenderableImageUrl(imageUrl)');
    });
  }
});
