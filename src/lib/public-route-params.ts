import { notFound } from 'next/navigation';

/**
 * App Router 的 page `params` 不會做 URL 解碼（API route 的 params 才會）。
 * 公開頁在使用 shopCode／slug 前先以此解碼；失敗、空字串或含控制字元一律回 null，
 * 呼叫端轉 notFound()。下游只編碼一次。
 */
export function decodePublicRouteParam(raw: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** 詳情頁 params：解碼 shopCode／slug，任一無效即 notFound()。 */
export async function resolvePublicTripDetailsParams(
  params: Promise<{ shopCode: string; slug: string }>,
): Promise<{ shopCode: string; slug: string }> {
  const raw = await params;
  const shopCode = decodePublicRouteParam(raw.shopCode);
  const slug = decodePublicRouteParam(raw.slug);
  if (!shopCode || !slug) notFound();
  return { shopCode, slug };
}
