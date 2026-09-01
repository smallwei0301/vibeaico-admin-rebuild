import { USE_MOCK } from '@/config/env';
import { adapt, ApiError, request } from '@/lib/api';
import type { ApiResponse } from '@/lib/types';
import { byMode } from '@/mock';
import type { KeywordReplyImageStorageRef } from '@/lib/keyword-reply-image';
import { keywordRepliesPage as t } from '@/i18n/zh-TW/pages/keyword-replies';

export type KeywordMatchType = 'EXACT' | 'CONTAINS';
export type KeywordActionType = 'REPLY_CONTENT' | 'START_PROFILE_COLLECTION';

/** One row used by `/tenant/keyword-replies`; the image ref is server evidence. */
export interface KeywordReplyRow {
  id: string;
  keyword: string;
  matchType: KeywordMatchType;
  actionType: KeywordActionType;
  replyText: string;
  /** Legacy rows may expose a bare URL for read/disable compatibility only. */
  imageUrl: string;
  imageStorageRef?: KeywordReplyImageStorageRef;
  linkUrl: string;
  linkLabel: string;
  enabled: boolean;
  overridesSystem: string;
}

interface KeywordReplyApiRow {
  id: string;
  keywords: string[];
  replyType: string;
  content: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
}

export interface KeywordReplyPayload {
  keywords: string[];
  replyType: 'TEXT' | 'IMAGE' | 'FLEX';
  content: Record<string, unknown>;
  active: boolean;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Page row -> API body. Only a complete server-issued ref can create IMAGE. */
export function toApiPayload(row: Omit<KeywordReplyRow, 'id'>): KeywordReplyPayload {
  const imageRef = row.actionType === 'REPLY_CONTENT' ? row.imageStorageRef : undefined;
  return {
    keywords: [row.keyword.trim()],
    replyType: imageRef ? 'IMAGE' : 'TEXT',
    content: {
      text: row.replyText,
      matchType: row.matchType,
      actionType: row.actionType,
      imageUrl: imageRef?.url ?? '',
      previewImageUrl: imageRef?.previewUrl ?? '',
      ...(imageRef ? { imageStorageRef: imageRef } : {}),
      linkUrl: row.linkUrl,
      linkLabel: row.linkLabel,
      overridesSystem: row.overridesSystem,
    },
    active: row.enabled,
  };
}

function isKeywordReplyImageRef(value: unknown): value is KeywordReplyImageStorageRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return ref.bucket === 'keyword-reply-images'
    && typeof ref.path === 'string'
    && typeof ref.url === 'string'
    && typeof ref.previewPath === 'string'
    && typeof ref.previewUrl === 'string';
}

/** API row -> page row. A malformed ref is not treated as upload evidence. */
export function fromApiRow(row: KeywordReplyApiRow): KeywordReplyRow {
  const content = row.content ?? {};
  return {
    id: row.id,
    keyword: row.keywords?.[0] ?? '',
    matchType: str(content.matchType) === 'EXACT' ? 'EXACT' : 'CONTAINS',
    actionType: str(content.actionType) === 'START_PROFILE_COLLECTION'
      ? 'START_PROFILE_COLLECTION'
      : 'REPLY_CONTENT',
    replyText: str(content.text) || str(content.replyText),
    imageUrl: str(content.imageUrl),
    imageStorageRef: row.replyType === 'IMAGE' && isKeywordReplyImageRef(content.imageStorageRef)
      ? content.imageStorageRef
      : undefined,
    linkUrl: str(content.linkUrl),
    linkLabel: str(content.linkLabel),
    enabled: !!row.active,
    overridesSystem: str(content.overridesSystem),
  };
}

const mockRows = (): KeywordReplyRow[] =>
  byMode<KeywordReplyRow[]>({
    LOCAL_SHOP: [
      {
        id: 'kw_1', keyword: '停車', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '店門口有 3 個機車位，汽車可停巷口的收費停車場（每小時 30 元）。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '價格', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '您好！剪髮 NT$600 起、染髮 NT$2,200 起，燙髮視髮長報價 😊',
        imageUrl: '', linkUrl: 'https://example.com/price', linkLabel: '查看更多',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '會員消費一次累積 1 點，滿 10 點折抵 300 元。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
    GUIDE: [
      {
        id: 'kw_1', keyword: '集合地點', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '所有行程統一在南方澳漁港遊客中心前集合，出發前一天會再傳一次定位給您。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '裝備', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '獨木舟與救生衣由我們準備，請自備防曬、換洗衣物與飲用水 🛶',
        imageUrl: '', linkUrl: 'https://example.com/gear', linkLabel: '裝備清單',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '老團員回訪每人折 200 元，報名時報上您的手機號碼即可。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
    CLINIC: [
      {
        id: 'kw_1', keyword: '健保', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '本院為健保特約診所，初診請攜帶健保卡與身分證件。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '自費', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '自費項目（雷射、營養針等）費用請洽櫃檯，或點下方連結查看價目表。',
        imageUrl: '', linkUrl: 'https://example.com/fee', linkLabel: '自費價目表',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '本院採會員回診提醒制，留下手機號碼即可收到回診通知。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
  });

export const listKeywordReplies = () =>
  adapt<KeywordReplyRow[]>(
    () => mockRows(),
    async () => (await request<KeywordReplyApiRow[]>('/api/settings/line/keyword-replies')).map(fromApiRow),
  );

let nextMockKeywordId = 1;

export const createKeywordReply = (row: Omit<KeywordReplyRow, 'id'>) =>
  adapt<{ id: string }>(
    () => ({ id: `kw_new_${nextMockKeywordId++}` }),
    () => request<{ id: string }>('/api/settings/line/keyword-replies', {
      method: 'POST',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

export const updateKeywordReply = (id: string, row: Omit<KeywordReplyRow, 'id'>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

export const setKeywordReplyActive = (id: string, active: boolean) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  );

export const deleteKeywordReply = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, { method: 'DELETE' }),
  );

type UploadResponse = { storageRef: KeywordReplyImageStorageRef };

/** Real upload only; mock mode reports unavailable instead of fabricating a URL. */
export async function uploadKeywordReplyImage(file: File): Promise<KeywordReplyImageStorageRef> {
  if (USE_MOCK)
    throw new ApiError(t.messages.imageRequiresRealMode);

  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/settings/line/keyword-replies/image', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  let body: ApiResponse<UploadResponse>;
  try {
    body = (await response.json()) as ApiResponse<UploadResponse>;
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, response.status);
  }
  if (!response.ok || body.success === false || !body.data?.storageRef)
    throw new ApiError(body.message ?? '圖片上傳失敗，請稍後再試', body.code, response.status);
  return body.data.storageRef;
}

/** Remove an uncommitted selection; the server rechecks tenant ownership and references. */
export const discardKeywordReplyImage = (storageRef: KeywordReplyImageStorageRef) =>
  USE_MOCK
    ? Promise.resolve()
    : request<void>('/api/settings/line/keyword-replies/image', {
      method: 'DELETE',
      body: JSON.stringify({ storageRef }),
    });
