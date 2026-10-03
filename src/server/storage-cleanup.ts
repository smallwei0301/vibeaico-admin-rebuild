import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from './supabase';
import { tenantOwnedPublicStoragePath, tenantOwnedPublicStorageUrl } from './storage';

/** keyword-reply 附加圖片使用的 bucket（`/api/upload` 白名單同名）。 */
export const KEYWORD_REPLY_IMAGES_BUCKET = 'keyword-reply-images';
export const RICHMENU_ASSETS_BUCKET = 'richmenu-assets';

type RichmenuLine = Record<string, unknown>;

/**
 * Return the canonical, tenant-owned rich-menu URLs in a complete line JSON.
 * External URLs and malformed legacy values deliberately stay out of the
 * retirement set; the database trigger remains the final fail-closed guard.
 */
export function richmenuAssetReferences(line: RichmenuLine, tenantId: string): Set<string> {
  const urls: string[] = [];
  if (typeof line.richMenuBgImageUrl === 'string' && line.richMenuBgImageUrl) {
    urls.push(line.richMenuBgImageUrl);
  }

  if (Array.isArray(line.flexCards)) {
    for (const card of line.flexCards) {
      if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
      const imageUrl = (card as Record<string, unknown>).imageUrl;
      if (typeof imageUrl === 'string' && imageUrl) urls.push(imageUrl);
    }
  }

  return new Set(
    urls
      .map((url) => tenantOwnedPublicStorageUrl(url, RICHMENU_ASSETS_BUCKET, tenantId))
      .filter((url): url is string => Boolean(url)),
  );
}

/**
 * Canonicalize rich-menu URLs at the application boundary before they reach
 * the retirement trigger. Non-rich-menu and external URLs are preserved.
 */
export function canonicalizeRichmenuLine(line: RichmenuLine, tenantId: string): RichmenuLine {
  const next = { ...line };
  if (typeof next.richMenuBgImageUrl === 'string' && next.richMenuBgImageUrl) {
    next.richMenuBgImageUrl =
      tenantOwnedPublicStorageUrl(next.richMenuBgImageUrl, RICHMENU_ASSETS_BUCKET, tenantId) ??
      next.richMenuBgImageUrl;
  }

  if (Array.isArray(next.flexCards)) {
    next.flexCards = next.flexCards.map((card) => {
      if (!card || typeof card !== 'object' || Array.isArray(card)) return card;
      const nextCard = { ...(card as Record<string, unknown>) };
      if (typeof nextCard.imageUrl === 'string' && nextCard.imageUrl) {
        nextCard.imageUrl =
          tenantOwnedPublicStorageUrl(nextCard.imageUrl, RICHMENU_ASSETS_BUCKET, tenantId) ??
          nextCard.imageUrl;
      }
      return nextCard;
    });
  }
  return next;
}

/**
 * Candidate set for cleanup after a successful settings write. Both sides
 * are canonicalized so query/fragment/percent-encoding aliases cannot create
 * a false replacement or duplicate retirement attempt.
 */
export function removedRichmenuAssetReferences(
  previousLine: RichmenuLine,
  nextLine: RichmenuLine,
  tenantId: string,
): string[] {
  const previous = richmenuAssetReferences(previousLine, tenantId);
  const next = richmenuAssetReferences(nextLine, tenantId);
  return [...previous].filter((url) => !next.has(url)).sort();
}

/** Detect the Phase A trigger conflict without swallowing other 23514 errors. */
export function isRetiredRichmenuAssetError(error: unknown): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown } | null;
  return candidate?.code === '23514' && (
    candidate.constraint === 'richmenu_asset_not_retired' ||
    candidate.message === 'richmenu asset has been retired'
  );
}

const KEYWORD_REPLY_REFERENCE_PAGE_SIZE = 200;

/**
 * 在刪除 keyword-reply 舊圖之前，確認同租戶其他回覆是否仍引用同一個 Storage 物件。
 *
 * 這裡故意用「不確定就當作仍被引用」的 fail-closed（不確定就不刪）策略：
 * - 比對前先用 `tenantOwnedPublicStorageUrl()` 正規化 URL，避免 query string、fragment
 *   或百分比編碼不同，明明是同一個物件卻被當成不同圖。
 * - 分頁掃完整個租戶，不只抓前 N 筆；每頁以 id 固定排序，避免分頁順序漂移。
 * - 查詢出錯時回 true，寧可留一個可之後回收的孤兒檔，也不要誤刪仍在使用的圖。
 *
 * 注意：這是 source-only best-effort 防線，不是跨交易的資料庫鎖。正常 UI 上傳每次會產生
 * 新物件，因此主要要防的是「既有資料已共用 URL」的真實情境；若未來允許多人同時把
 * 同一舊 URL 指派給不同回覆，應由 #572 的共用 Storage cleanup 工作升級為 DB 原子 retire。
 */
export async function keywordReplyImageMayStillBeReferenced(params: {
  supabase: SupabaseClient;
  tenantId: string;
  excludeReplyId: string;
  canonicalUrl: string;
}): Promise<boolean> {
  const { supabase, tenantId, excludeReplyId, canonicalUrl } = params;

  for (let from = 0; ; from += KEYWORD_REPLY_REFERENCE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('keyword_replies')
      .select('id, content')
      .eq('tenant_id', tenantId)
      .neq('id', excludeReplyId)
      .order('id', { ascending: true })
      .range(from, from + KEYWORD_REPLY_REFERENCE_PAGE_SIZE - 1);

    if (error) {
      console.error('[storage-cleanup] 無法確認舊 keyword 圖片是否仍被引用，保守跳過刪除', {
        tenantId,
        excludeReplyId,
        message: error.message,
      });
      return true;
    }

    const rows = data ?? [];
    for (const row of rows) {
      const content = (row.content ?? {}) as Record<string, unknown>;
      const imageUrl = typeof content.imageUrl === 'string' ? content.imageUrl : '';
      if (!imageUrl) continue;

      const canonical =
        tenantOwnedPublicStorageUrl(imageUrl, KEYWORD_REPLY_IMAGES_BUCKET, tenantId) ?? imageUrl;
      if (canonical === canonicalUrl) return true;
    }

    if (rows.length < KEYWORD_REPLY_REFERENCE_PAGE_SIZE) return false;
  }
}

/**
 * Best-effort 刪除一個「由 `/api/upload` 產生、租戶自己名下」的 Storage 物件。
 *
 * 保證：
 * - 空字串／非本站 public URL／不是這個租戶第一段路徑 → 直接 no-op。
 * - Storage 刪除失敗（網路、權限、物件已不存在…）→ 只記錄 log，絕不 throw。
 *   換圖／移除圖片的儲存結果不能因為舊圖清理失敗而一起失敗。
 *
 * 本函式只負責「這個 URL 可不可以解析成租戶自己的物件」與「實際 remove」。
 * 是否仍被其他資料列引用，必須由呼叫端先完成，例如 keyword reply 先呼叫
 * `keywordReplyImageMayStillBeReferenced()`。
 */
export async function deleteTenantStorageObjectBestEffort(params: {
  bucket: string;
  url: string;
  tenantId: string;
}): Promise<void> {
  const { bucket, url, tenantId } = params;
  if (!url) return;

  const path = tenantOwnedPublicStoragePath(url, bucket, tenantId);
  if (!path) return;

  try {
    const admin = createAdminSupabase();
    const { error } = await admin.storage.from(bucket).remove([path]);
    if (error) {
      console.error('[storage-cleanup] 刪除舊 Storage 物件失敗（best-effort，不影響儲存結果）', {
        bucket,
        path,
        message: error.message,
      });
    }
  } catch (err) {
    console.error('[storage-cleanup] 刪除舊 Storage 物件時拋出例外（best-effort，不影響儲存結果）', {
      bucket,
      path,
      err,
    });
  }
}

/**
 * Atomically retire one canonical rich-menu URL, then best-effort remove its
 * Storage object. Only a successful service-role retirement may reach the
 * irreversible Storage remove call; RPC false/error is fail-closed.
 */
export async function retireRichmenuAssetBestEffort(params: {
  url: string;
  tenantId: string;
}): Promise<boolean> {
  const { url, tenantId } = params;
  const canonicalUrl = tenantOwnedPublicStorageUrl(url, RICHMENU_ASSETS_BUCKET, tenantId);
  const path = tenantOwnedPublicStoragePath(url, RICHMENU_ASSETS_BUCKET, tenantId);
  if (!canonicalUrl || !path) return false;

  try {
    const admin = createAdminSupabase();
    const { data: retired, error } = await admin.rpc('retire_richmenu_asset', {
      p_tenant_id: tenantId,
      p_image_url: canonicalUrl,
    });
    if (error) {
      console.error('[storage-cleanup] richmenu retirement RPC failed; keeping Storage object', {
        tenantId,
        canonicalUrl,
        message: error.message,
      });
      return false;
    }
    if (retired !== true) return false;

    await deleteTenantStorageObjectBestEffort({
      bucket: RICHMENU_ASSETS_BUCKET,
      url: canonicalUrl,
      tenantId,
    });
    return true;
  } catch (err) {
    console.error('[storage-cleanup] richmenu retirement failed; keeping Storage object', {
      tenantId,
      canonicalUrl,
      err,
    });
    return false;
  }
}

/** Cleanup every removed URL once, preserving the fail-closed boundary. */
export async function cleanupRemovedRichmenuAssetsBestEffort(params: {
  previousLine: RichmenuLine;
  nextLine: RichmenuLine;
  tenantId: string;
}): Promise<void> {
  const { previousLine, nextLine, tenantId } = params;
  for (const url of removedRichmenuAssetReferences(previousLine, nextLine, tenantId)) {
    await retireRichmenuAssetBestEffort({ url, tenantId });
  }
}
