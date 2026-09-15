/**
 * tests/unit/owner-notify-postback.18.test.ts
 * -----------------------------------------------------------------------------
 * 守 Issue #18「重用既有 webhook，不建新端點」：`handleEvent()` 的 postback 分派
 * 要把 `ownerNotifyConfirm:<id>` / `ownerNotifyDecline:<id>` 導去
 * `confirmOwnerNotifyBind` / `declineOwnerNotifyBind`，不是丟給尚未實作的
 * 聊天下單流程或直接吃掉。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const confirmMock = vi.fn(async (..._args: any[]) => ({ ok: true }));
const declineMock = vi.fn(async (..._args: any[]) => undefined);

vi.mock('@/server/owner-notify', () => ({
  confirmOwnerNotifyBind: (...a: any[]) => confirmMock(...a),
  declineOwnerNotifyBind: (...a: any[]) => declineMock(...a),
}));

// handleEvent 的 message/follow/unfollow 分支會拉進一堆與本測試無關的模組
// （ai-reply、trip-flex…），這裡不需要它們真的運作，只需要 import 不炸掉。
vi.mock('@/server/flex-menu', () => ({ buildFlexMenuOutcome: vi.fn() }));
vi.mock('@/server/trip-flex', () => ({ buildTripCarousel: vi.fn(), TRIP_CAROUSEL_MAX: 10 }));
vi.mock('@/server/features', () => ({ isFeatureActive: vi.fn(async (..._args: any[]) => false) }));
vi.mock('@/server/campaign-rewards', () => ({ grantCampaignRewards: vi.fn() }));
vi.mock('@/server/ai-reply', () => ({ aiReply: vi.fn() }));

import { handleEvent } from '@/server/line-events';

const admin = {} as any;
const tenant = { id: 'tenant-a', shop_code: 'shop1', name: '測試店' };

beforeEach(() => {
  confirmMock.mockClear();
  declineMock.mockClear();
});

describe('handleEvent postback 分派 — owner-notify（Issue #18）', () => {
  it('ownerNotifyConfirm:<id> → 呼叫 confirmOwnerNotifyBind(admin, tenantId, id, lineUserId)', async () => {
    await handleEvent(admin, tenant, 'tok', {}, {
      type: 'postback',
      source: { userId: 'lu_1' },
      postback: { data: 'ownerNotifyConfirm:req-123' },
    });
    expect(confirmMock).toHaveBeenCalledWith(admin, 'tenant-a', 'req-123', 'lu_1');
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('ownerNotifyDecline:<id> → 呼叫 declineOwnerNotifyBind(admin, tenantId, id, lineUserId)', async () => {
    await handleEvent(admin, tenant, 'tok', {}, {
      type: 'postback',
      source: { userId: 'lu_2' },
      postback: { data: 'ownerNotifyDecline:req-456' },
    });
    expect(declineMock).toHaveBeenCalledWith(admin, 'tenant-a', 'req-456', 'lu_2');
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('沒有 userId 的 postback 一律忽略，不呼叫任何 owner-notify 函式', async () => {
    await handleEvent(admin, tenant, 'tok', {}, {
      type: 'postback',
      source: {},
      postback: { data: 'ownerNotifyConfirm:req-789' },
    });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('不相關的 postback data 不觸發 owner-notify 函式', async () => {
    await handleEvent(admin, tenant, 'tok', {}, {
      type: 'postback',
      source: { userId: 'lu_1' },
      postback: { data: 'action=someOtherFlow' },
    });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
  });
});
