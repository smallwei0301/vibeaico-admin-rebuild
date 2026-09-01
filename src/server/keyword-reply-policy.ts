/**
 * Feature policy for keyword-reply mutations.
 *
 * Disabling an existing reply is cleanup/control work and must remain
 * available after KEYWORD_REPLY expires. Every other supported PUT mutation
 * can change what the tenant sends and therefore remains feature-gated.
 */
export type KeywordReplyUpdateInput = {
  keywords?: unknown;
  replyType?: unknown;
  content?: unknown;
  active?: unknown;
  sortOrder?: unknown;
};

export function isKeywordReplyDisableOnlyUpdate(
  update: KeywordReplyUpdateInput,
): boolean {
  return update.active === false
    && Object.keys(update).length === 1
    && Object.prototype.hasOwnProperty.call(update, 'active');
}

export function keywordReplyUpdateRequiresFeature(
  update: KeywordReplyUpdateInput,
): boolean {
  return !isKeywordReplyDisableOnlyUpdate(update);
}
