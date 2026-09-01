/**
 * Persisted reference for a keyword-reply image pair.
 *
 * The URL fields are kept for the LINE message contract, while the paths are
 * the ownership/cleanup evidence. They are always produced and validated by
 * the server; the browser must not invent them.
 */
export const KEYWORD_REPLY_IMAGES_BUCKET = 'keyword-reply-images' as const;

export type KeywordReplyImageStorageRef = {
  bucket: typeof KEYWORD_REPLY_IMAGES_BUCKET;
  path: string;
  url: string;
  previewPath: string;
  previewUrl: string;
};
