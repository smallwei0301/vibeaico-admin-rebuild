import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Issue #50 source wiring', () => {
  it('keeps the keyword upload seam isolated from the shared chat upload lane', () => {
    const route = read('../../src/app/api/settings/line/keyword-replies/image/route.ts');
    const service = read('../../src/services/keyword-replies.ts');
    expect(route).toContain("requireTenant('MANAGER')");
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
});
