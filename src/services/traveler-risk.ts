/**
 * 旅客風險政策（GUIDE，issue #44）— 頁面唯一資料入口，見 CLAUDE.md「頁面永不
 * fetch」：頁面只認這裡的函式，mock／real 兩分支都包在 adapt() 裡。
 *
 * 對應 API：`src/app/api/customers/[id]/risk-policy/route.ts`。
 */
import { adapt, request } from '@/lib/api';
import type {
  TravelerRiskDeposit,
  TravelerRiskPolicy,
  TravelerRiskPolicyDetail,
  TravelerRiskPolicyKind,
} from '@/lib/types';
import { MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

export type AssignTravelerRiskPolicyPayload = {
  policy: TravelerRiskPolicyKind;
  deposit?: TravelerRiskDeposit;
  reason: string;
  actorLabel: string;
};

let nextMockPolicyId = 1;

/**
 * mock 分支：per-mode、per-customer 的 append-only 帳本（陣列，最新在前），
 * 延遲初始化——`MOCK_MODE` 是 AppShell 切租戶時才 reassign 的 live binding，
 * 不可在 module scope 求值（見 CLAUDE.md）。
 */
const mockRiskPolicyStore = new Map<BusinessType, Map<string, TravelerRiskPolicy[]>>();

function getMockHistory(customerId: string): TravelerRiskPolicy[] {
  if (!mockRiskPolicyStore.has(MOCK_MODE)) mockRiskPolicyStore.set(MOCK_MODE, new Map());
  const byCustomer = mockRiskPolicyStore.get(MOCK_MODE)!;
  return byCustomer.get(customerId) ?? [];
}

function setMockHistory(customerId: string, history: TravelerRiskPolicy[]): void {
  if (!mockRiskPolicyStore.has(MOCK_MODE)) mockRiskPolicyStore.set(MOCK_MODE, new Map());
  mockRiskPolicyStore.get(MOCK_MODE)!.set(customerId, history);
}

/** GET /api/customers/:id/risk-policy */
export function getTravelerRiskPolicy(customerId: string): Promise<TravelerRiskPolicyDetail> {
  return adapt(
    () => {
      const history = getMockHistory(customerId);
      return { current: history[0] ?? null, history };
    },
    () => request<TravelerRiskPolicyDetail>(`/api/customers/${customerId}/risk-policy`),
  );
}

/** POST /api/customers/:id/risk-policy — 指派一筆新政策事件（含解除＝再指派 DEFAULT）。*/
export function assignTravelerRiskPolicy(
  customerId: string,
  payload: AssignTravelerRiskPolicyPayload,
): Promise<TravelerRiskPolicy> {
  return adapt(
    () => {
      const entry: TravelerRiskPolicy = {
        id: `trp_mock_${nextMockPolicyId++}`,
        policy: payload.policy,
        deposit: payload.policy === 'FORCE_DEPOSIT' ? payload.deposit ?? null : null,
        reason: payload.reason,
        actorLabel: payload.actorLabel,
        createdAt: new Date().toISOString(),
      };
      setMockHistory(customerId, [entry, ...getMockHistory(customerId)]);
      return entry;
    },
    () => request<TravelerRiskPolicy>(`/api/customers/${customerId}/risk-policy`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  );
}
