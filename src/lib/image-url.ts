/** 只渲染 http(s)、根相對路徑或 blob:（mock 上傳預覽）；javascript:/data:/裸檔名一律不渲染。 */
export const isRenderableImageUrl = (url: string): boolean => /^((https?:)?\/|blob:)/.test(url);
