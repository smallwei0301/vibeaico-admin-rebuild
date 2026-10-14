/** #951：狀態頁「複製連結」的純函式；複製出去的網址不帶 created（避免日後再開又顯示「剛送出」）。 */
export function buildCopyUrl(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete('created');
    return url.toString();
  } catch {
    return href;
  }
}

export type CopyResult = 'copied' | 'failed';

export async function copyStatusLink(
  href: string,
  clipboard: { writeText: (text: string) => Promise<void> } | undefined | null,
): Promise<CopyResult> {
  if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed';
  try {
    await clipboard.writeText(buildCopyUrl(href));
    return 'copied';
  } catch {
    return 'failed';
  }
}
