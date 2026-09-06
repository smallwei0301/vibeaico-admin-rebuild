import { USE_MOCK } from '@/config/env';
import type { ApiResponse } from './types';

/**
 * API adapter
 * -----------------------------------------------------------------------------
 * 骨架模式（NEXT_PUBLIC_USE_MOCK=true）走 src/mock；關掉後同一組函式改打真實後端。
 * 頁面元件只認得 src/services/* 的函式，不直接 fetch —— 換後端時頁面完全不用動。
 *
 * 原站回應格式固定為 { success, data?, message?, code? }，錯誤碼例：AUTH_005。
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export async function request<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | boolean | undefined> },
): Promise<T> {
  const { query, ...rest } = init ?? {};
  const qs = query
    ? '?' +
      new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';

  const res = await fetch(`${BASE}${path}${qs}`, {
    ...rest,
    headers: {
      // Let the browser add the multipart boundary for FormData. Setting an
      // application/json content type here makes /api/upload reject the body.
      ...(typeof FormData !== 'undefined' && rest.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(rest.headers ?? {}),
    },
    credentials: 'include',
  });

  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('伺服器回應格式錯誤', undefined, res.status);
  }

  if (!res.ok || body.success === false) {
    throw new ApiError(body.message ?? '操作失敗，請稍後再試', body.code, res.status);
  }
  return body.data as T;
}

/** 模擬網路延遲，讓 loading 狀態在骨架模式下也看得到 */
export const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

/** 在 mock 與真實 API 之間切換的小工具 */
export async function adapt<T>(mock: () => T | Promise<T>, real: () => Promise<T>): Promise<T> {
  if (USE_MOCK) {
    await delay();
    return mock();
  }
  return real();
}
