import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Issue #50 source wiring', () => {
  it('keeps the keyword upload seam isolated from the shared chat upload lane', () => {
    const route = read('../../src/app/api/settings/line/keyword-replies/image/route.ts');
    const service = read('../../src/services/keyword-replies.ts');
    expect(route).toContain("requireTenant('MANAGER')");
    expect(route).toContain("requireFeature(t.tenantId, 'KEYWORD_REPLY')");
    expect(route).toContain('uploadKeywordReplyImage');
    expect(service).toContain("/api/settings/line/keyword-replies/image");
    expect(service).not.toContain('URL.createObjectURL');
  });

  it('has truthful upload ownership/status UI and does not keep the old inert file input', () => {
    const page = read('../../src/app/tenant/keyword-replies/page.tsx');
    expect(page).toContain('onChange={(e) => {');
    expect(page).toContain('handleImageChange');
    expect(page).toContain('imageUploading');
    expect(page).toContain('imageUploadError');
    expect(page).toContain('discardKeywordReplyImage');
    expect(page).toContain('listKeywordReplies');
  });

  it('uses the stored ref for IMAGE replies and fail-closes missing objects', () => {
    const lineEvents = read('../../src/server/line-events.ts');
    const crud = read('../../src/app/api/settings/line/keyword-replies/route.ts');
    expect(lineEvents).toContain('requireKeywordReplyImage');
    expect(lineEvents).toContain('ref?.previewUrl');
    expect(crud).toContain('requireKeywordReplyImage');
    expect(crud).toContain('imageStorageRef');
  });

  it('guards concurrent image replacement and provisional cleanup', () => {
    const update = read('../../src/app/api/settings/line/keyword-replies/[id]/route.ts');
    const images = read('../../src/server/keyword-reply-images.ts');
    expect(update).toContain(".filter('content', 'eq', JSON.stringify(existing.content ?? {}))");
    expect(update).toContain(".select('content').maybeSingle()");
    expect(update).toContain('oldContent: deletedContent');
    expect(update).toContain('withKeywordReplyImagePathsLock');
    expect(update).toContain('markKeywordReplyImagePersisted');
    expect(images).toContain('KEYWORD_REPLY_IMAGE_LOCK_PREFIX');
    expect(images).toContain('withKeywordReplyImagePathsLock');
    expect(images).toContain(".not('path', 'like'");
    expect(images).toContain('KEYWORD_REPLY_IMAGE_PROVISIONAL_TTL_MS');
    expect(images).toContain("from('keyword_reply_image_cleanup')");
    expect(images).toContain(".lt(");
  });

  it('uses the same DB-backed path boundary for create, discard, and cleanup', () => {
    const create = read('../../src/app/api/settings/line/keyword-replies/route.ts');
    const discard = read('../../src/app/api/settings/line/keyword-replies/image/route.ts');
    const images = read('../../src/server/keyword-reply-images.ts');
    expect(create).toContain('withKeywordReplyImagePathsLock');
    expect(discard).toContain('removeUnreferencedKeywordReplyImage');
    expect(images).toContain('await withKeywordReplyImagePathsLock({');
  });
});
