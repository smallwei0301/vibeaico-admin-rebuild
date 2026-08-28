import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toApiPayload } from '@/services/keyword-replies';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BUCKET = 'keyword-reply-images';

describe('Issue #50：keyword reply 圖片的完整 source wiring', () => {
  it('上傳白名單、LINE 格式限制和前端 UploadBucket 三處都有專用 bucket', () => {
    const upload = withoutComments(read('src/server/upload.ts'));
    const service = withoutComments(read('src/services/upload.ts'));
    expect(upload).toContain('KEYWORD_REPLY_IMAGES_BUCKET');
    expect(upload).toMatch(/LINE_BOUND_BUCKETS\s*=\s*new Set\([\s\S]*KEYWORD_REPLY_IMAGES_BUCKET/);
    expect(service).toContain(`'${BUCKET}'`);
  });

  it('頁面選 JPEG/PNG 後真的 uploadFile，顯示上傳狀態與預覽；不再留下尚未建置文案', () => {
    const page = withoutComments(read('src/app/tenant/keyword-replies/page.tsx'));
    const dictionary = withoutComments(read('src/i18n/zh-TW/pages/keyword-replies.ts'));
    expect(page).toContain("uploadFile(file, 'keyword-reply-images')");
    expect(page).toContain('discardKeywordReplyImage');
    expect(page).toContain('closeDraft');
    expect(page).toContain('accept="image/jpeg,image/png"');
    expect(page).toContain("imageUploadState === 'uploading'");
    expect(page).toContain('draft.imageUrl');
    expect(page).not.toContain('imageNotBuilt');
    expect(dictionary).not.toContain('imageNotBuilt');
  });

  it('modal 關閉與重疊上傳以 session/generation 決定 ownership，失去 ownership 的結果自行清理', () => {
    const page = withoutComments(read('src/app/tenant/keyword-replies/page.tsx'));
    expect(page).toContain('draftSessionRef.current !== session');
    expect(page).toContain('uploadGenerationRef.current !== generation');
    expect(page).toContain('discardProvisionalImage(uploadedRef)');
    expect(page).toContain('discardProvisionalImage(provisionalImageRef.current)');
    expect(page).not.toContain("disabled={imageUploadState === 'uploading'}");
  });

  it('save in-flight 時 Cancel/backdrop/Escape/X 共用 close guard，不得刪除即將持久化的 provisional ref', () => {
    const page = withoutComments(read('src/app/tenant/keyword-replies/page.tsx'));
    const modal = withoutComments(read('src/components/ui/Modal.tsx'));
    expect(page).toContain('savingRef.current = true');
    expect(page).toMatch(/const closeDraft = \(\) => \{\s*if \(savingRef\.current\) return;/);
    expect(page).toContain('disabled={saving} onClick={closeDraft}');
    expect(page).toContain('onClose={closeDraft}');
    expect(modal).toContain('modal-backdrop" onClick={onClose}');
    expect(modal).toContain("e.key === 'Escape' && onClose()");
    expect(modal).toMatch(/aria-label=\{common\.close\}[^>]+onClick=\{onClose\}/);
  });

  it('service payload 會帶 imageStorageRef，不只是一個可偽造的 imageUrl', () => {
    const imageStorageRef = {
      bucket: 'keyword-reply-images' as const,
      path: '11111111-1111-4111-8111-111111111111/x.png',
      url: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/x.png',
      previewPath: '11111111-1111-4111-8111-111111111111/x.preview.png',
      previewUrl: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/x.preview.png',
    };
    const payload = toApiPayload({
      keyword: '圖片', matchType: 'EXACT', actionType: 'REPLY_CONTENT', replyText: '圖在這裡',
      imageUrl: imageStorageRef.url, imageStorageRef, linkUrl: '', linkLabel: '', enabled: true,
      overridesSystem: '',
    });
    expect(payload.replyType).toBe('IMAGE');
    expect(payload.content.imageStorageRef).toEqual(imageStorageRef);
    expect(payload.content.previewImageUrl).toBe(imageStorageRef.previewUrl);
  });

  it('create/update/get 都驗 tenant-owned object 存在，替換、刪除或取消選檔都清理', () => {
    const create = withoutComments(read('src/app/api/settings/line/keyword-replies/route.ts'));
    const detail = withoutComments(read('src/app/api/settings/line/keyword-replies/[id]/route.ts'));
    const images = withoutComments(read('src/server/keyword-reply-images.ts'));
    expect(create).toContain('requireKeywordReplyImage');
    expect(create).toContain("if (row.reply_type === 'IMAGE' && row.content?.imageStorageRef)");
    expect(detail).toContain('requireKeywordReplyImage(nextContent');
    expect(detail.match(/cleanupReplacedKeywordReplyImage/g)?.length).toBe(3);
    expect(images).toContain('.info(ref.path)');
    expect(images).toContain(".from('keyword_reply_image_cleanup')");
    expect(images).toContain(".select('tenant_id, bucket, path, attempts')");
    expect(images).toContain('isKeywordReplyImageReferenced(refs ?? [], job.path)');
    expect(images).toContain('ref.previewPath');
    const discard = read('src/app/api/settings/line/keyword-replies/image/route.ts');
    expect(discard).toContain('removeUnreferencedKeywordReplyImage');
    expect(discard).toContain('previewPath: z.string()');
    expect(discard).toContain('previewUrl: z.string()');
  });

  it('storage ref 只有一份 frontend/backend contract，不在各層複製匿名結構', () => {
    const contract = read('src/lib/types.ts');
    expect(contract).toContain('export type StorageRef');
    expect(contract).toContain('export type KeywordReplyImageStorageRef');
    expect(contract).toContain('previewPath: string');
    expect(read('src/services/keyword-replies.ts')).toContain("import type { KeywordReplyImageStorageRef } from '@/lib/types'");
    expect(read('src/services/upload.ts')).toContain("import type { StorageRef } from '@/lib/types'");
  });

  it('migration uses a dedicated public bucket and a retryable cleanup queue driven by authenticated cron', () => {
    const migration = read('supabase/migrations/0039_keyword_reply_images.sql');
    const cron = read('src/app/api/cron/keyword-reply-image-cleanup/route.ts');
    const config = read('vercel.json');
    expect(migration).toMatch(/\('keyword-reply-images', 'keyword-reply-images', true,/);
    expect(migration).toContain('file_size_limit');
    expect(migration).toContain("array['image/jpeg','image/png']::text[]");
    expect(migration).toMatch(/on conflict \(id\) do update set[\s\S]*public = excluded\.public/);
    expect(migration).toContain('keyword_reply_image_cleanup');
    expect(migration).toMatch(/revoke all on table public\.keyword_reply_image_cleanup from anon, authenticated/i);
    expect(cron).toContain('Bearer ${process.env.CRON_SECRET}');
    expect(config).toContain('/api/cron/keyword-reply-image-cleanup');
  });
});
