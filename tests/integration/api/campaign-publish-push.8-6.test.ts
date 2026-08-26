/**
 * 活動發布 → **真的推播** 整合測試（14 分冊 §8.6 擁有者裁決）
 * -----------------------------------------------------------------------------
 * §8.6 原文：
 *
 *   > 文案「活動已發布，LINE 推播已發送」保留，`POST /api/campaigns/:id/publish`
 *   > 要補上實際的推播與額度扣減。缺的是實作而不是文案。
 *
 * 這一條先前被**反向執行**（issue #7 乙把文案刪掉並註明「禁止復原」，端點仍只有
 * 一句 `.update({ status: 'PUBLISHED' })`）。本檔釘的是補齊後的實作。
 *
 * 契約出處：04 分冊 §B-5（campaigns 端點與狀態機）、06 分冊 §2（推播額度）與 §5。
 * 實作 src/app/api/campaigns/[id]/publish/route.ts。
 * 前端鏈路：src/app/tenant/campaigns/page.tsx（runPending 的 publish 分支）
 *   → src/services/campaigns.ts `publishCampaign`
 *   → 本檔端點。文案與行為是否一致由 tests/unit/campaign-publish-copy.8-6.test.ts 釘。
 *
 * ⚠️ 本檔驗的不是「端點回 200」。回 200 太容易了——先前那一版每次都回 200，
 * 而且一則 LINE 訊息都沒送出。所以每一條正向案例都用 **mock LINE 收到的 multicast
 * 本體**（收件人清單與訊息文字）與 **push_quota_usage 的實際數字**當證據。
 *
 * ⚠️ 反向斷言（「這一次一則都不該送出」）用**障壁**，不用固定秒數等待
 * （14 分冊 §6.16-a：`bookings-modified.27` 的 1 秒窗口已被實測證明會假綠燈）。
 * 障壁作法與 line-booking-notify.06 相同：在 **SHOP_B**（獨立的 LINE 憑證、
 * 獨立的推播額度列、獨立的 line_users）發布一個**一定會推**的活動，等它抵達 mock，
 * 再斷言 mock 收到的 multicast **只有障壁那一則**。
 *
 * 障壁為什麼成立（本檔比 line-booking-notify 更強）：這支端點的 multicast 是
 * **await 在 HTTP 回應之前**的，不是 fire-and-forget。受測那一次的 HTTP 回應拿到手時，
 * 它若有推播就一定已經抵達 mock；障壁那一次的請求又是在此之後才送出。
 * 兩次觸發之間沒有任何共用寫入（額度、憑證、追蹤者全部按租戶隔開），沒有競態。
 * 障壁在這裡的作用是把「零請求」界定成一個**已抵達的正向訊號旁邊的空白**，
 * 而不是「我們等了一下，沒看到東西」。
 *
 * 清理紀律：本檔自建的 campaigns / line_users 於 afterAll 全刪；兩店的
 * tenant_settings（兩個 *_enc）與 push_quota_usage 當月列先快照後還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const MULTICAST_PATH = '/v2/bot/message/multicast';

const CHANNEL_SECRET_A = 'itest-cmpush86-secret-a';
const CHANNEL_TOKEN_A = 'itest-cmpush86-token-a';
const CHANNEL_SECRET_B = 'itest-cmpush86-secret-b';
const CHANNEL_TOKEN_B = 'itest-cmpush86-token-b';

/** A 店：兩位追蹤中 + 一位已封鎖（封鎖者不該收到，與 marketing 同規則） */
const U1 = 'Ucmpush86itest00000000000000001';
const U2 = 'Ucmpush86itest00000000000000002';
const U_BLOCKED = 'Ucmpush86itest00000000000000003';
/** B 店障壁：整檔固定，案例期間不改 */
const U_BARRIER = 'Ucmpush86itest00000000000000009';

/** SHOP_A 的種子含 EXTRA_PUSH 訂閱 → 推播上限 700（09 分冊 §5、src/server/line.ts） */
const QUOTA_LIMIT_A = 700;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

type PublishResult = {
  pushed: boolean;
  sentCount: number;
  pushSkipReason?: string;
  pushErrorMessage?: string;
};

type SettingsSnapshot = {
  line_channel_secret_enc: string | null;
  line_channel_access_token_enc: string | null;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();
const settingsSnapshot: Record<string, SettingsSnapshot> = {};
const quotaSnapshot: Record<string, number | null> = {};
const createdIds: string[] = [];

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function quotaUsed(tenantId: string = SHOP_A.id): Promise<number> {
  const { data, error } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', tenantId).eq('month', taipeiMonthKey()).maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number, tenantId: string = SHOP_A.id): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: tenantId, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

/** service role 直查活動列（期望值一律直查現有資料，不信端點自己的回應） */
async function campaignStatus(id: string): Promise<string | null> {
  const { data, error } = await admin.from('campaigns')
    .select('status').eq('id', id).maybeSingle();
  expect(error).toBeNull();
  return (data as { status: string } | null)?.status ?? null;
}

/** 走端點建一筆草稿活動，回 id */
async function createCampaign(
  api: AuthedApi, body: Record<string, unknown>,
): Promise<string> {
  const res = await api.post('/api/campaigns', body);
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as Envelope<{ id: string }>;
  createdIds.push(data!.id);
  return data!.id;
}

async function publish(api: AuthedApi, id: string): Promise<{
  status: number; body: Envelope<PublishResult>;
}> {
  const res = await api.post(`/api/campaigns/${id}/publish`);
  return { status: res.status, body: (await res.json()) as Envelope<PublishResult> };
}

/**
 * 障壁：在 B 店發布一個一定會推的活動，回它抵達 mock 之後的 multicast 清單。
 * 呼叫端接著斷言「清單裡只有障壁這一則」。
 */
async function fireBarrier(): Promise<void> {
  const id = await createCampaign(ownerB, {
    name: '#8.6 障壁活動（B 店）',
    content: { text: '障壁：這一則一定會送出' },
  });
  const { body } = await publish(ownerB, id);
  expect(body.success).toBe(true);
  expect(body.data).toMatchObject({ pushed: true, sentCount: 1 });
}

/** mock 收到的 multicast 之中，屬於障壁那一則的索引（用收件人辨識） */
function barrierCalls() {
  return mock.requestsFor(MULTICAST_PATH)
    .filter((r) => (r.body?.to as string[] | undefined)?.includes(U_BARRIER));
}
function nonBarrierCalls() {
  return mock.requestsFor(MULTICAST_PATH)
    .filter((r) => !(r.body?.to as string[] | undefined)?.includes(U_BARRIER));
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 '
      + 'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts '
      + '打到 tests/helpers/line-mock.ts 起的本地假 LINE server。',
    );
  }

  admin = createClient(
    process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  await mock.start();

  for (const [tenantId, secret, token] of [
    [SHOP_A.id, CHANNEL_SECRET_A, CHANNEL_TOKEN_A],
    [SHOP_B.id, CHANNEL_SECRET_B, CHANNEL_TOKEN_B],
  ] as const) {
    const { data: snap, error: e0 } = await admin.from('tenant_settings')
      .select('line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', tenantId).single();
    expect(e0).toBeNull();
    settingsSnapshot[tenantId] = snap as SettingsSnapshot;
    const { error: e1 } = await admin.from('tenant_settings').update({
      line_channel_secret_enc: encryptSecret(secret),
      line_channel_access_token_enc: encryptSecret(token),
    }).eq('tenant_id', tenantId);
    expect(e1).toBeNull();

    const { data: q } = await admin.from('push_quota_usage').select('used')
      .eq('tenant_id', tenantId).eq('month', taipeiMonthKey()).maybeSingle();
    quotaSnapshot[tenantId] = (q as { used: number } | null)?.used ?? null;
  }

  const { error: e2 } = await admin.from('line_users').insert([
    { tenant_id: SHOP_A.id, line_user_id: U1, display_name: '#8.6 追蹤者1', followed: true },
    { tenant_id: SHOP_A.id, line_user_id: U2, display_name: '#8.6 追蹤者2', followed: true },
    { tenant_id: SHOP_A.id, line_user_id: U_BLOCKED, display_name: '#8.6 已封鎖', followed: false },
    { tenant_id: SHOP_B.id, line_user_id: U_BARRIER, display_name: '#8.6 障壁好友', followed: true },
  ]);
  expect(e2).toBeNull();
});

afterAll(async () => {
  for (const id of createdIds) await admin.from('campaigns').delete().eq('id', id);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id)
    .in('line_user_id', [U1, U2, U_BLOCKED]);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_B.id)
    .eq('line_user_id', U_BARRIER);

  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    const snap = settingsSnapshot[tenantId];
    if (snap) {
      await admin.from('tenant_settings').update({
        line_channel_secret_enc: snap.line_channel_secret_enc,
        line_channel_access_token_enc: snap.line_channel_access_token_enc,
      }).eq('tenant_id', tenantId);
    }
    const q = quotaSnapshot[tenantId];
    if (q === null) {
      await admin.from('push_quota_usage').delete()
        .eq('tenant_id', tenantId).eq('month', taipeiMonthKey());
    } else {
      await setQuotaUsed(q, tenantId);
    }
  }
  await mock.stop();
});

beforeEach(async () => {
  mock.reset();
  await setQuotaUsed(0, SHOP_A.id);
  await setQuotaUsed(0, SHOP_B.id);
});

/* ========================================================================== */

describe('§8.6 發布活動 → 真的 multicast 給所有追蹤者，並扣推播額度', () => {
  it('一般活動發布 → mock LINE 收到 multicast，收件人正好是兩位追蹤者（已封鎖者不在內），額度 -2', async () => {
    const id = await createCampaign(ownerA, {
      name: '#8.6 一般活動', content: { text: '新春限時：全店 9 折，只到月底！' },
    });

    const { status, body } = await publish(ownerA, id);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ pushed: true, sentCount: 2 });

    // 證據一：mock LINE 真的收到 multicast，而且內容就是活動的推播文案
    const calls = mock.requestsFor(MULTICAST_PATH);
    expect(calls.length).toBe(1);
    expect((calls[0].body.to as string[]).slice().sort())
      .toEqual([U1, U2].slice().sort());
    expect(calls[0].body.messages)
      .toEqual([{ type: 'text', text: '新春限時：全店 9 折，只到月底！' }]);
    // 已封鎖的好友不在收件人裡（與 marketing 的 followed=true 交集同規則）
    expect(calls[0].body.to).not.toContain(U_BLOCKED);

    // 證據二：額度按人數扣（06 分冊 §2：multicast 佔額度）
    expect(await quotaUsed()).toBe(2);
    // 證據三：狀態真的轉了
    expect(await campaignStatus(id)).toBe('PUBLISHED');
  });

  it('「自動觸發」活動發布 → 依原站規格不在當下群發：pushed=false、額度不動，且障壁證明零 multicast', async () => {
    const id = await createCampaign(ownerA, {
      name: '#8.6 自動觸發活動',
      content: { text: '生日快樂！', isAutoTrigger: true },
    });

    const { status, body } = await publish(ownerA, id);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      pushed: false, sentCount: 0, pushSkipReason: 'AUTO_TRIGGER',
    });
    expect(await campaignStatus(id)).toBe('PUBLISHED');
    expect(await quotaUsed()).toBe(0);

    // 障壁：B 店那一則一定會到；到了之後 A 店這一次仍然一則都沒有
    await fireBarrier();
    expect(barrierCalls().length).toBe(1);
    expect(nonBarrierCalls()).toEqual([]);
  });

  it('推播額度不足 → 活動照樣發布（PUBLISHED），但 pushed=false、額度一則都沒被吃掉，障壁證明零 multicast', async () => {
    // 只剩 1 則，但有 2 位追蹤者
    await setQuotaUsed(QUOTA_LIMIT_A - 1, SHOP_A.id);
    const id = await createCampaign(ownerA, {
      name: '#8.6 額度不足', content: { text: '這一則不該送出' },
    });

    const { status, body } = await publish(ownerA, id);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      pushed: false, sentCount: 0, pushSkipReason: 'QUOTA_EXCEEDED',
    });

    // 這一條就是本輪的設計決定：發布與推播分開，發布仍然成立
    expect(await campaignStatus(id)).toBe('PUBLISHED');
    // 額度一則都沒被吃掉（不足時連扣都不該扣）
    expect(await quotaUsed()).toBe(QUOTA_LIMIT_A - 1);

    await fireBarrier();
    expect(barrierCalls().length).toBe(1);
    expect(nonBarrierCalls()).toEqual([]);
  });

  it('沒有任何追蹤者 → pushed=false（NO_RECIPIENTS）、活動仍發布、額度不動，障壁證明零 multicast', async () => {
    const { error: eOff } = await admin.from('line_users')
      .update({ followed: false })
      .eq('tenant_id', SHOP_A.id).in('line_user_id', [U1, U2]);
    expect(eOff).toBeNull();
    try {
      const id = await createCampaign(ownerA, {
        name: '#8.6 沒有追蹤者', content: { text: '沒人收得到' },
      });
      const { body } = await publish(ownerA, id);
      expect(body.data).toMatchObject({
        pushed: false, sentCount: 0, pushSkipReason: 'NO_RECIPIENTS',
      });
      expect(await campaignStatus(id)).toBe('PUBLISHED');
      expect(await quotaUsed()).toBe(0);

      await fireBarrier();
      expect(barrierCalls().length).toBe(1);
      expect(nonBarrierCalls()).toEqual([]);
    } finally {
      await admin.from('line_users').update({ followed: true })
        .eq('tenant_id', SHOP_A.id).in('line_user_id', [U1, U2]);
    }
  });

  it('沒有推播訊息（content.text 空）→ pushed=false（NO_MESSAGE）、額度不動，障壁證明零 multicast', async () => {
    const id = await createCampaign(ownerA, { name: '#8.6 沒有文案', content: {} });

    const { body } = await publish(ownerA, id);
    expect(body.data).toMatchObject({
      pushed: false, sentCount: 0, pushSkipReason: 'NO_MESSAGE',
    });
    expect(await campaignStatus(id)).toBe('PUBLISHED');
    expect(await quotaUsed()).toBe(0);

    await fireBarrier();
    expect(barrierCalls().length).toBe(1);
    expect(nonBarrierCalls()).toEqual([]);
  });

  it('LINE 平台回錯 → 端點仍回 200 但 pushed=false（LINE_ERROR）並帶原文，活動已發布、額度照實已扣', async () => {
    mock.failNextFor(MULTICAST_PATH, 500);
    const id = await createCampaign(ownerA, {
      name: '#8.6 LINE 回錯', content: { text: 'LINE 會回 500' },
    });

    const { status, body } = await publish(ownerA, id);
    expect(status).toBe(200);
    expect(body.data?.pushed).toBe(false);
    expect(body.data?.pushSkipReason).toBe('LINE_ERROR');
    // 原文要帶出來給畫面顯示，不可以只留一句「失敗」
    expect(body.data?.pushErrorMessage).toContain('LINE API 錯誤');
    expect(body.data?.sentCount).toBe(0);

    // 發布本身成立；額度**不退**（與 marketing 同規則，理由見端點檔頭）
    expect(await campaignStatus(id)).toBe('PUBLISHED');
    expect(await quotaUsed()).toBe(2);
  });

  it('重複發布 → 第二次 409，不會再扣一次額度、也不會再推一次（障壁證明第二次零 multicast）', async () => {
    const id = await createCampaign(ownerA, {
      name: '#8.6 重複發布', content: { text: '只該送出一次' },
    });

    const first = await publish(ownerA, id);
    expect(first.body.data).toMatchObject({ pushed: true, sentCount: 2 });
    expect(await quotaUsed()).toBe(2);

    mock.reset();
    const second = await publish(ownerA, id);
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.code).toBe('REQ_003');

    // 額度沒有被扣第二次
    expect(await quotaUsed()).toBe(2);
    await fireBarrier();
    expect(barrierCalls().length).toBe(1);
    expect(nonBarrierCalls()).toEqual([]);
  });

  it('別家店的活動 id → 404，且不會推播（跨租戶隔離）', async () => {
    const id = await createCampaign(ownerB, {
      name: '#8.6 B 店的活動', content: { text: 'A 店不該碰得到' },
    });

    const { status, body } = await publish(ownerA, id);
    expect(status).toBe(404);
    expect(body.code).toBe('REQ_002');
    expect(await campaignStatus(id)).toBe('DRAFT');
    expect(mock.requestsFor(MULTICAST_PATH)).toEqual([]);
  });
});
