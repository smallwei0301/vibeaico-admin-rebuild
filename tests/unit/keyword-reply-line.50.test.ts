import { describe, expect, it } from 'vitest';
import { keywordReplyMessage } from '@/server/line-events';

const ref = {
  bucket: 'keyword-reply-images' as const,
  path: '11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
  url: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
  previewPath: '11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeeeee.preview.png',
  previewUrl: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeeeee.preview.png',
};

describe('Issue #50 LINE keyword reply mapping', () => {
  it('sends one image message with separate original and preview URLs', () => {
    expect(keywordReplyMessage({
      reply_type: 'IMAGE',
      content: { imageUrl: ref.url, previewImageUrl: ref.previewUrl, imageStorageRef: ref },
    })).toEqual({
      type: 'image',
      originalContentUrl: ref.url,
      previewImageUrl: ref.previewUrl,
    });
  });

  it('keeps legacy image rows readable without fabricating a storage ref', () => {
    expect(keywordReplyMessage({
      reply_type: 'IMAGE',
      content: { imageUrl: 'https://legacy.example/image.png' },
    })).toEqual({
      type: 'image',
      originalContentUrl: 'https://legacy.example/image.png',
      previewImageUrl: 'https://legacy.example/image.png',
    });
  });
});
