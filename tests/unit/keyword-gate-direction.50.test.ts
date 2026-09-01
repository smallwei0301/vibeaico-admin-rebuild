import { describe, expect, it } from 'vitest';
import {
  isKeywordReplyDisableOnlyUpdate,
  keywordReplyUpdateRequiresFeature,
} from '@/server/keyword-reply-policy';

describe('Issue #50 KEYWORD_REPLY direction policy', () => {
  it('allows only an exact active=false update without the feature', () => {
    expect(isKeywordReplyDisableOnlyUpdate({ active: false })).toBe(true);
    expect(keywordReplyUpdateRequiresFeature({ active: false })).toBe(false);
  });

  it.each([
    { active: true },
    { active: false, keywords: ['new keyword'] },
    { active: false, replyType: 'TEXT' },
    { active: false, content: { text: 'changed' } },
    { active: false, sortOrder: 1 },
    {},
  ])('keeps every other update feature-gated: %j', (update) => {
    expect(isKeywordReplyDisableOnlyUpdate(update)).toBe(false);
    expect(keywordReplyUpdateRequiresFeature(update)).toBe(true);
  });
});
