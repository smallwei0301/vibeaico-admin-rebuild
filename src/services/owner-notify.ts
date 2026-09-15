import { ApiError, adapt, request } from '@/lib/api';
import { MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

/** GET /api/settings/line/owner-notify 的接收者列（Issue #18）。 */
export type OwnerNotifyRecipient = {
  id: string;
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  isPrimary: boolean;
  notifyNewBooking: boolean;
  notifyCancel: boolean;
  createdAt: string;
};

export type OwnerNotifyOverview = {
  recipients: OwnerNotifyRecipient[];
  maxRecipients: number;
  /** 實測的 LINE provider 連線狀態；「已綁定」不等於「provider 可連線」。 */
  providerHealthy: boolean;
  providerHealthReason: string;
};

export type OwnerNotifyLineUserCandidate = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  createdAt: string;
  pendingBindRequestId: string | null;
};

const OWNER_NOTIFY_MAX_RECIPIENTS = 3;

/* --------------------------------------------------------------- mock 資料 */
/**
 * 業態各自一份、延遲初始化（呼叫時才讀 MOCK_MODE，不可在 module 頂層求值，
 * 見 CLAUDE.md 的 mock 資料規則）。三個業態的候選好友名字各自不同 flavor，
 * 避免共用同一份 id 序列洩漏另一個業態的文案。
 */
type MockCandidate = OwnerNotifyLineUserCandidate & { isRecipient: boolean };
type MockState = {
  candidates: MockCandidate[];
  recipients: OwnerNotifyRecipient[];
  nextRecipientSeq: number;
};

function seedCandidates(mode: BusinessType): MockCandidate[] {
  const names: Record<BusinessType, string[]> = {
    LOCAL_SHOP: ['陳老闆娘', '店長 Amy', '設計師阿凱'],
    GUIDE: ['領隊阿明', '副領隊小雨', '在地嚮導 Tom'],
    CLINIC: ['王醫師', '護理長 Sandy', '櫃檯主任小林'],
  };
  return names[mode].map((displayName, i) => ({
    lineUserId: `on_lu_${mode}_${i + 1}`,
    displayName,
    pictureUrl: '',
    createdAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
    pendingBindRequestId: null,
    isRecipient: false,
  }));
}

const mockStateByMode = new Map<BusinessType, MockState>();

function getMockState(): MockState {
  if (!mockStateByMode.has(MOCK_MODE)) {
    mockStateByMode.set(MOCK_MODE, {
      candidates: seedCandidates(MOCK_MODE),
      recipients: [],
      nextRecipientSeq: 1,
    });
  }
  return mockStateByMode.get(MOCK_MODE)!;
}

function mockOverview(): OwnerNotifyOverview {
  const s = getMockState();
  return {
    recipients: s.recipients,
    maxRecipients: OWNER_NOTIFY_MAX_RECIPIENTS,
    // demo 模式沒有真的 LINE provider 可連——誠實回報「未設定」而不是假裝已連線
    // （Issue #18：「已綁定」與「provider 可連線」是兩個不同概念）。
    providerHealthy: false,
    providerHealthReason: '骨架模式（demo）沒有真正的 LINE 連線，僅供操作示範',
  };
}

/* ------------------------------------------------------------------- API */

export const getOwnerNotifyOverview = () =>
  adapt<OwnerNotifyOverview>(
    () => mockOverview(),
    () => request<OwnerNotifyOverview>('/api/settings/line/owner-notify'),
  );

export const listOwnerNotifyLineUsers = () =>
  adapt<OwnerNotifyLineUserCandidate[]>(
    () => getMockState().candidates.filter((c) => !c.isRecipient)
      .map(({ isRecipient: _isRecipient, ...c }) => c),
    () => request<OwnerNotifyLineUserCandidate[]>('/api/settings/line/owner-notify/line-users'),
  );

export const initiateOwnerNotifyBind = (lineUserId: string) =>
  adapt<{ requestId: string; expiresAt: string }>(
    () => {
      const s = getMockState();
      const candidate = s.candidates.find((c) => c.lineUserId === lineUserId);
      if (!candidate) throw new ApiError('找不到此 LINE 好友', 'REQ_002', 404);
      if (s.recipients.length >= OWNER_NOTIFY_MAX_RECIPIENTS) {
        throw new ApiError(`老闆通知名單已達上限（${OWNER_NOTIFY_MAX_RECIPIENTS} 位）`, 'LINE_003', 409);
      }
      const requestId = `on_req_${MOCK_MODE}_${candidate.lineUserId}`;
      candidate.pendingBindRequestId = requestId;
      return { requestId, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    },
    () => request<{ requestId: string; expiresAt: string }>('/api/settings/line/owner-notify/bind', {
      method: 'POST', body: JSON.stringify({ lineUserId }),
    }),
  );

/**
 * 模擬「本人已在 LINE 上按下確認」——demo 模式沒有真的 LINE 對話可等對方按鈕，
 * 直接落地成正式接收者，讓骨架模式可以走完整段驗收流程。真後端呼叫同名端點，
 * 該端點的用途見 route 檔頭：一般情況下加入名單是 webhook postback 直接完成，
 * 這支端點是給沒有真 LINE webhook 環境時重放同一段邏輯用的。
 */
export const confirmOwnerNotifyBind = (requestId: string, lineUserId: string) =>
  adapt<void>(
    () => {
      const s = getMockState();
      const candidate = s.candidates.find((c) => c.lineUserId === lineUserId);
      if (!candidate || candidate.pendingBindRequestId !== requestId) {
        throw new ApiError('邀請已不存在或對象不符', 'LINE_004', 409);
      }
      if (s.recipients.length >= OWNER_NOTIFY_MAX_RECIPIENTS) {
        throw new ApiError(`老闆通知名單已達上限（${OWNER_NOTIFY_MAX_RECIPIENTS} 位）`, 'LINE_003', 409);
      }
      candidate.isRecipient = true;
      candidate.pendingBindRequestId = null;
      s.recipients.push({
        id: `on_rcpt_${s.nextRecipientSeq++}`,
        lineUserId: candidate.lineUserId,
        displayName: candidate.displayName,
        pictureUrl: candidate.pictureUrl,
        isPrimary: s.recipients.length === 0,
        notifyNewBooking: true,
        notifyCancel: true,
        createdAt: new Date().toISOString(),
      });
      return undefined;
    },
    () => request<void>('/api/settings/line/owner-notify/recipients', {
      method: 'POST', body: JSON.stringify({ requestId, lineUserId }),
    }),
  );

export type OwnerNotifyRecipientPatch = {
  notifyNewBooking?: boolean;
  notifyCancel?: boolean;
  isPrimary?: true;
};

export const updateOwnerNotifyRecipient = (id: string, patch: OwnerNotifyRecipientPatch) =>
  adapt<void>(
    () => {
      const s = getMockState();
      const r = s.recipients.find((x) => x.id === id);
      if (!r) throw new ApiError('找不到此接收者', 'REQ_002', 404);
      if (patch.isPrimary) s.recipients.forEach((x) => { x.isPrimary = x.id === id; });
      if (patch.notifyNewBooking !== undefined) r.notifyNewBooking = patch.notifyNewBooking;
      if (patch.notifyCancel !== undefined) r.notifyCancel = patch.notifyCancel;
      return undefined;
    },
    () => request<void>(`/api/settings/line/owner-notify/recipients/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  );

export const removeOwnerNotifyRecipient = (id: string) =>
  adapt<void>(
    () => {
      const s = getMockState();
      const idx = s.recipients.findIndex((x) => x.id === id);
      if (idx < 0) throw new ApiError('找不到此接收者', 'REQ_002', 404);
      const [removed] = s.recipients.splice(idx, 1);
      const candidate = s.candidates.find((c) => c.lineUserId === removed.lineUserId);
      if (candidate) candidate.isRecipient = false;
      if (removed.isPrimary && s.recipients.length > 0) {
        const next = [...s.recipients].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )[0];
        next.isPrimary = true;
      }
      return undefined;
    },
    () => request<void>(`/api/settings/line/owner-notify/recipients/${id}`, { method: 'DELETE' }),
  );

export const removeAllOwnerNotifyRecipients = () =>
  adapt<void>(
    () => {
      const s = getMockState();
      s.candidates.forEach((c) => { c.isRecipient = false; });
      s.recipients = [];
      return undefined;
    },
    () => request<void>('/api/settings/line/owner-notify/recipients', { method: 'DELETE' }),
  );
