import { describe, expect, it } from 'vitest';
import { fromApiRow, toApiPayload, type KeywordReplyRow } from '@/services/keyword-replies';

const ref = {
  bucket: 'keyword-reply-images' as const,
  path: '11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png',
  url: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeeeee.png',
  previewPath: '11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeeeee.preview.png',
  previewUrl: 'https://project.supabase.co/storage/v1/object/public/keyword-reply-images/11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeeeeee.preview.png',
};

const row: Omit<KeywordReplyRow, 'id'> = {
  keyword: '價目表',
  matchType: 'EXACT',
  actionType: 'REPLY_CONTENT',
  replyText: '請看圖片',
  imageUrl: ref.url,
  imageStorageRef: ref,
  linkUrl: '',
  linkLabel: '',
  enabled: true,
  overridesSystem: '',
};

describe('Issue #50 keyword reply service contract', () => {
  it('only emits IMAGE and both URLs when a complete server ref exists', () => {
    expect(toApiPayload(row)).toEqual({
      keywords: ['價目表'],
      replyType: 'IMAGE',
      content: {
        text: '請看圖片',
        matchType: 'EXACT',
        actionType: 'REPLY_CONTENT',
        imageUrl: ref.url,
        previewImageUrl: ref.previewUrl,
        imageStorageRef: ref,
        linkUrl: '',
        linkLabel: '',
        overridesSystem: '',
      },
      active: true,
    });
    expect(toApiPayload({ ...row, imageStorageRef: undefined, imageUrl: 'https://external.invalid/fake.png' }).replyType)
      .toBe('TEXT');
  });

  it('round-trips the server row without fabricating a storage ref', () => {
    expect(fromApiRow({
      id: 'reply-1', keywords: ['價目表'], replyType: 'IMAGE', active: true, sortOrder: 0,
      content: { text: '請看圖片', matchType: 'EXACT', actionType: 'REPLY_CONTENT', imageUrl: ref.url, imageStorageRef: ref },
    })).toMatchObject({ ...row, id: 'reply-1' });
    expect(fromApiRow({
      id: 'legacy-1', keywords: ['舊圖'], replyType: 'IMAGE', active: true, sortOrder: 0,
      content: { imageUrl: 'https://legacy.example/image.png' },
    }).imageStorageRef).toBeUndefined();
  });
});
