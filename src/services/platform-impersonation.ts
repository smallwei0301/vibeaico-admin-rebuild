import { adapt, request } from '@/lib/api';

/**
 * 平台管理者代登入的資料進出口（21 分冊）。
 *
 * mock 分支一律回「沒有代入中」：骨架模式沒有 platform_admins、沒有 session，
 * 任何「代入中」的畫面都會是憑空捏造的狀態。
 */
export interface ImpersonationState {
  active: boolean;
  tenantId?: string;
  tenantName?: string;
  shopCode?: string;
  expiresAt?: string;
}

export interface ImpersonationLogEntry {
  id: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export interface ImpersonationActionEntry {
  id: string;
  sessionId: string;
  method: string;
  path: string;
  status: number;
  at: string;
}

export function getImpersonationState(): Promise<ImpersonationState> {
  return adapt<ImpersonationState>(
    () => ({ active: false }),
    () => request<ImpersonationState>('/api/platform/impersonation/current'),
  );
}

export interface ImpersonationTarget {
  tenantId: string;
  tenantName: string;
  shopCode: string;
  businessType: string;
}

export function getImpersonationTarget(p: { guide?: string; tenantId?: string }) {
  return adapt<ImpersonationTarget>(
    () => {
      throw new Error('mock');
    },
    () =>
      request<ImpersonationTarget>('/api/platform/impersonation/target', {
        query: { guide: p.guide, tenantId: p.tenantId },
      }),
  );
}

export function startImpersonation(p: { guideId?: string; tenantId?: string; reason: string }) {
  return adapt<ImpersonationState & { sessionId: string }>(
    () => {
      throw new Error('mock');
    },
    () =>
      request<ImpersonationState & { sessionId: string }>('/api/platform/impersonation/start', {
        method: 'POST',
        body: JSON.stringify(p),
      }),
  );
}

export function endImpersonation() {
  return adapt<{ ended: boolean }>(
    () => ({ ended: true }),
    () => request<{ ended: boolean }>('/api/platform/impersonation/end', { method: 'POST' }),
  );
}

export function getImpersonationLog() {
  return adapt<{ sessions: ImpersonationLogEntry[]; actions: ImpersonationActionEntry[] }>(
    () => ({ sessions: [], actions: [] }),
    () =>
      request<{ sessions: ImpersonationLogEntry[]; actions: ImpersonationActionEntry[] }>(
        '/api/settings/impersonation-log',
      ),
  );
}
