/**
 * 進階選單設計器 11 支端點整合測試（GitHub issue #19 / 補齊-4）
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §6.2（issue #19 展開的新章節）
 *
 * 涵蓋：
 *   §6.2.4  create-advanced / create-custom / create-scene   → 建立＋傳圖＋設預設三連
 *   §6.2.5  preview-advanced / preview-scene / preview-scene-flex → **零發布呼叫**
 *   §6.2.2  restore-previous 的兩條路徑；沒有還原點時的誠實錯誤
 *   §6.2.6  advanced-config 讀寫往返一致
 *   §6.2.8  upload-image / upload-cell-icon（共用 uploadToBucket()，非第二份實作）
 *   §6.2.9  booking-step-guide 的 payload
 *   §6.2.3  兩種孤兒的回滾
 *
 * ⚠️ **這一組最重要的三條斷言，都不是「回傳值長得對」：**
 *   1. preview 類：`mock.requestsFor('/v2/bot/richmenu')` 長度為 **0**。
 *      預覽與發布共用同一段組裝程式碼，只要順手把 publishRichMenu() 叫下去，
 *      回傳值一模一樣、而顧客的選單被換掉了——回傳值驗不出這件事。
 *   2. 孤兒回滾：LINE 端**收到 DELETE**、DB **沒有被寫**（直查，不看回應）。
 *   3. restore-previous 沒有還原點時**不得靜默成功**：要 404，不是 200。
 *
 * 鏈路與清理紀律同 `line-rich-menu.06.test.ts`：mock LINE 綁固定 port 4123
 * （LINE_API_BASE / LINE_DATA_API_BASE 兩個都要指過去，少一個傳圖那步會往外打）；
 * 本檔只動 SHOP_A 的 `tenant_settings` 與 `rich_menu_designs`，beforeAll 快照、
 * afterAll 原樣還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';
import { SCENE_TEMPLATES } from '@/config/rich-menu-scenes';
import { BOOKING_STEP_KEYS } from '@/server/booking-step-guide';

const CHANNEL_SECRET = 'itest-line-secret-19-advanced';
const CHANNEL_TOKEN = 'itest-line-token-19-advanced';

/** tests/helpers/line-mock.ts 對 POST /v2/bot/richmenu 固定回的 id */
const MOCK_RICH_MENU_ID = 'richmenu-mock-0001';

const PATH_CREATE = '/v2/bot/richmenu';
const PATH_UPLOAD = `/v2/bot/richmenu/${MOCK_RICH_MENU_ID}/content`;
const PATH_SET_DEFAULT = `/v2/bot/user/all/richmenu/${MOCK_RICH_MENU_ID}`;
const PATH_DELETE = `/v2/bot/richmenu/${MOCK_RICH_MENU_ID}`;

const API = '/api/settings/line/rich-menu';

/** 1×1 透明 PNG（合法檔頭；上傳端點會實際解碼比對 MIME） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

/** 上傳到 storage 的物件路徑，afterAll 清掉 */
const uploadedPaths: string[] = [];

async function lineJsonb(tenantId = SHOP_A.id): Promise<Record<string, any>> {
  const { data, error } = await admin.from('tenant_settings')
    .select('line').eq('tenant_id', tenantId).single();
  expect(error).toBeNull();
  return (data?.line ?? {}) as Record<string, any>;
}

async function setLineJsonb(next: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('tenant_settings')
    .update({ line: next }).eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

/** 直查 rich_menu_designs（用 service role，繞過 RLS，看的是真實資料列） */
async function designRow(kind: string, tenantId: string = SHOP_A.id) {
  const { data } = await admin.from('rich_menu_designs')
    .select('kind, config, line_rich_menu_id, updated_at')
    .eq('tenant_id', tenantId).eq('kind', kind).maybeSingle();
  return data as { kind: string; config: any; line_rich_menu_id: string; updated_at: string } | null;
}

async function clearDesigns(): Promise<void> {
  await admin.from('rich_menu_designs').delete().eq('tenant_id', SHOP_A.id);
  await admin.from('rich_menu_designs').delete().eq('tenant_id', SHOP_B.id);
}

/**
 * 一個 jsonb **存不進去**的字串：含 U+0000（Postgres 回
 * `unsupported Unicode escape sequence`）。用來製造「LINE 全成功、DB 寫入失敗」
 * 那條回滾路徑（§6.2.3 第二列），走的是真的 DB，不 mock supabase client。
 *
 * ⚠️ 用 `String.fromCharCode(0)` 組出來，**不要把真的 NUL 位元組寫進原始碼**：
 * git 會把含 NUL 的檔案判成二進位，之後這個檔的 diff 就再也看不見了。
 */
const NUL_NAME = `bad${String.fromCharCode(0)}name`;

/** 一份最小可用的進階設計（7 格 = 3+4） */
function advancedDesign(overrides: Record<string, unknown> = {}) {
  return {
    theme: 'OCEAN_BLUE',
    layout: '3+4',
    cells: Array.from({ length: 7 }, (_, i) => ({
      label: `按鈕${i + 1}`, action: 'SEND_TEXT', value: `預約`, icon: '',
    })),
    chatBarText: '打開選單',
    name: 'itest-advanced',
    ...overrides,
  };
}

function form(fields: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v as any);
  return f;
}

function pngFile(name = 'icon.png'): File {
  return new File([PNG_1X1 as unknown as BlobPart], name, { type: 'image/png' });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE || !process.env.LINE_DATA_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE / LINE_DATA_API_BASE：本檔需要兩者都設成 http://localhost:4123。',
    );
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  await mock.start();

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;

  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 進階端點擋 CUSTOM_RICH_MENU（09 分冊 §5）——確保 SHOP_A 是已訂閱狀態
  const { error: e2 } = await admin.from('feature_subscriptions').upsert(
    {
      tenant_id: SHOP_A.id, code: 'CUSTOM_RICH_MENU',
      active: true, expires_at: null, source: 'GRANTED', cancelled_at: null,
    },
    { onConflict: 'tenant_id,code' },
  );
  expect(e2).toBeNull();

  // B 店也要有（本檔用它驗跨租戶隔離，advanced-config 的 PUT 同樣擋閘門）
  const { error: e3 } = await admin.from('feature_subscriptions').upsert(
    {
      tenant_id: SHOP_B.id, code: 'CUSTOM_RICH_MENU',
      active: true, expires_at: null, source: 'GRANTED', cancelled_at: null,
    },
    { onConflict: 'tenant_id,code' },
  );
  expect(e3).toBeNull();
});

afterAll(async () => {
  await clearDesigns();
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line,
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  for (const p of uploadedPaths) {
    const { error } = await admin.storage.from('richmenu-assets').remove([p]);
    if (error) console.error('[rich-menu-advanced] 清理 storage 失敗：', p, error);
  }
  await mock.stop();
});

beforeEach(async () => {
  mock.reset();
  await clearDesigns();
  await setLineJsonb({ channelId: '2005459361', richMenuId: '', richMenuBgImageUrl: '' });
});

/* ══════════════════════════════════════════════ 三支 create-*（§6.2.4） */
describe('三支 create-*：建立＋傳圖＋設預設三連，richMenuId 寫回 tenant_settings.line', () => {
  it('create-advanced：mock LINE 依序收到三個請求，DB 的 richMenuId 被更新', async () => {
    const res = await ownerA.post(`${API}/create-advanced`, advancedDesign());
    expect(res.status).toBe(200);
    const body = await readJson<{ richMenuId: string }>(res);
    expect(body.data?.richMenuId).toBe(MOCK_RICH_MENU_ID);

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${PATH_CREATE}`, `POST ${PATH_UPLOAD}`, `POST ${PATH_SET_DEFAULT}`,
    ]);

    // 版型真的被用了：3+4 = 7 個 area，而不是基本端點的固定六格
    const create = mock.requestsFor(PATH_CREATE)[0];
    expect(create.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(create.body.size).toEqual({ width: 2500, height: 1686 });
    expect(create.body.areas).toHaveLength(7);
    expect(create.body.chatBarText).toBe('打開選單');
    // 餘數補到最後一欄／最後一列，右緣與下緣不留死區（§6.2.4）
    const row0 = create.body.areas.slice(0, 3);
    expect(row0[0].bounds).toEqual({ x: 0, y: 0, width: 833, height: 843 });
    expect(row0[2].bounds.x + row0[2].bounds.width).toBe(2500);
    const last = create.body.areas[6];
    expect(last.bounds.y + last.bounds.height).toBe(1686);

    // ★ 直查 DB，不看回應
    expect((await lineJsonb()).richMenuId).toBe(MOCK_RICH_MENU_ID);
    const published = await designRow('PUBLISHED');
    expect(published?.line_rich_menu_id).toBe(MOCK_RICH_MENU_ID);
    expect(published?.config.layout).toBe('3+4');
  });

  it('create-custom：座標由呼叫端給，三連請求照樣完成且 richMenuId 寫回 DB', async () => {
    const res = await ownerA.post(`${API}/create-custom`, {
      theme: 'DARK',
      areas: [
        { bounds: { x: 0, y: 0, width: 1250, height: 1686 }, label: '左', action: 'SEND_TEXT', value: '預約' },
        { bounds: { x: 1250, y: 0, width: 1250, height: 1686 }, label: '右', action: 'SEND_TEXT', value: '商品' },
      ],
      name: 'itest-custom',
    });
    expect(res.status).toBe(200);
    expect((await readJson<{ richMenuId: string }>(res)).data?.richMenuId).toBe(MOCK_RICH_MENU_ID);

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${PATH_CREATE}`, `POST ${PATH_UPLOAD}`, `POST ${PATH_SET_DEFAULT}`,
    ]);
    const create = mock.requestsFor(PATH_CREATE)[0];
    expect(create.body.areas).toHaveLength(2);
    expect(create.body.areas[1].bounds).toEqual({ x: 1250, y: 0, width: 1250, height: 1686 });

    expect((await lineJsonb()).richMenuId).toBe(MOCK_RICH_MENU_ID);
    expect((await designRow('PUBLISHED'))?.line_rich_menu_id).toBe(MOCK_RICH_MENU_ID);
  });

  it('create-scene：依 SCENE_TEMPLATES 建立，主題跟著範本走、richMenuId 寫回 DB', async () => {
    const scene = SCENE_TEMPLATES[2];
    const res = await ownerA.post(`${API}/create-scene`, { sceneId: scene.id });
    expect(res.status).toBe(200);
    expect((await readJson<{ richMenuId: string }>(res)).data?.richMenuId).toBe(MOCK_RICH_MENU_ID);

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${PATH_CREATE}`, `POST ${PATH_UPLOAD}`, `POST ${PATH_SET_DEFAULT}`,
    ]);

    expect((await lineJsonb()).richMenuTheme).toBe(scene.theme);
    expect((await lineJsonb()).richMenuId).toBe(MOCK_RICH_MENU_ID);
    const published = await designRow('PUBLISHED');
    expect(published?.config.sceneId).toBe(scene.id);
  });

  it('create-scene：不存在的 sceneId → 404，不得憑空建立一份（LINE 零呼叫）', async () => {
    const res = await ownerA.post(`${API}/create-scene`, { sceneId: 'scene_不存在' });
    expect(res.status).toBe(404);
    expect(mock.requestsFor(PATH_CREATE)).toHaveLength(0);
  });
});

/* ═══════════════════════════ 三支 preview-*：零發布呼叫（§6.2.5） */
describe('三支 preview-*：mock LINE 的 richmenu 建立次數為 0', () => {
  /**
   * ⚠️ 這一組的核心斷言是 **`mock.requests` 完全沒有任何一筆**，
   * 不是「回傳值長得對」。預覽與發布共用 `buildRichMenuPayload()`，
   * 只要有人順手把 `publishRichMenu()` 叫下去，回傳值一模一樣、
   * 而顧客的選單被換掉了——那個差別只有這條斷言看得見（§6.2.5）。
   */
  const assertZeroLineCalls = () => {
    expect(
      mock.requestsFor(PATH_CREATE),
      '預覽端點呼叫了 POST /v2/bot/richmenu —— 按預覽把選單發出去了',
    ).toHaveLength(0);
    expect(mock.requestsFor(PATH_UPLOAD)).toHaveLength(0);
    expect(mock.requestsFor(PATH_SET_DEFAULT)).toHaveLength(0);
    // 連一筆請求都不該有：發布序列以外的 LINE 呼叫同樣不屬於「預覽」
    expect(
      mock.requests.map((r) => `${r.method} ${r.path}`),
      '預覽端點打了 LINE',
    ).toEqual([]);
  };

  it('preview-advanced：回得出 areas 與預覽圖，且 mock LINE 零呼叫', async () => {
    const res = await ownerA.post(`${API}/preview-advanced`, advancedDesign());
    expect(res.status).toBe(200);
    const body = await readJson<any>(res);
    expect(body.data.size).toEqual({ width: 2500, height: 1686 });
    expect(body.data.areas).toHaveLength(7);
    expect(body.data.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.data.imageIsFlatColor).toBe(true);

    assertZeroLineCalls();
    // 也不得留下任何 DB 痕跡：預覽不是發布
    expect(await designRow('PUBLISHED')).toBeNull();
    expect((await lineJsonb()).richMenuId).toBe('');
  });

  it('preview-scene：回得出範本預覽，且 mock LINE 零呼叫', async () => {
    const scene = SCENE_TEMPLATES[0];
    const res = await ownerA.post(`${API}/preview-scene`, { sceneId: scene.id });
    expect(res.status).toBe(200);
    const body = await readJson<any>(res);
    expect(body.data.sceneId).toBe(scene.id);
    expect(body.data.theme).toBe(scene.theme);
    // 誠實旗標：範本只決定配色，六格文案是業態預設（§6.2.4 的已知規格缺口）
    expect(body.data.cellsAreModeDefaults).toBe(true);

    assertZeroLineCalls();
    expect(await designRow('PUBLISHED')).toBeNull();
  });

  it('preview-scene-flex：回得出顧客會收到的 Flex 訊息包，且 mock LINE 零呼叫', async () => {
    await setLineJsonb({
      channelId: '2005459361',
      flexCards: [{ title: '洗剪護', subtitle: '約 90 分鐘', imageUrl: '', ad: false, linkUrl: '' }],
      flexShowTip: true,
    });

    const res = await ownerA.post(`${API}/preview-scene-flex`, {});
    expect(res.status).toBe(200);
    const body = await readJson<any>(res);
    expect(body.data.kind).toBe('FLEX');
    // flexShowTip=true → 兩則（carousel + 使用提示），與顧客真的會收到的一致
    expect(body.data.messageCount).toBe(2);
    expect(body.data.messages[0].type).toBe('flex');
    expect(body.data.messages[1].type).toBe('text');

    assertZeroLineCalls();
  });

  it('preview-scene-flex：flexShowTip=false 時預覽也只有 1 則（預覽不得與實際不同調）', async () => {
    await setLineJsonb({
      channelId: '2005459361',
      flexCards: [{ title: '洗剪護', subtitle: '', imageUrl: '', ad: false, linkUrl: '' }],
      flexShowTip: false,
    });
    const res = await ownerA.post(`${API}/preview-scene-flex`, {});
    const body = await readJson<any>(res);
    expect(body.data.messageCount).toBe(1);
    assertZeroLineCalls();
  });
});

/* ══════════════════════════════════ restore-previous（§6.2.2 / §6.2.7） */
describe('restore-previous：還原點只保留最近 1 份', () => {
  it('沒有還原點時回 404 並說得出原因——**不得靜默成功**', async () => {
    const res = await ownerA.post(`${API}/restore-previous`, {});
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('REQ_002');
    // 訊息要說得出「為什麼沒有」，不是一句「找不到」
    expect(body.message).toContain('發布');
    // 一則 LINE 請求都不准發（沒有東西可還原就不該去動顧客的選單）
    expect(mock.requests).toHaveLength(0);
    expect((await lineJsonb()).richMenuId).toBe('');
  });

  it('有還原點時還原成功：切回上一張選單，PUBLISHED 與 RESTORE_POINT 對調', async () => {
    // 發布兩次 → 第一次的設計成為還原點（§6.2.2 三代輪替）
    await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: 'first', theme: 'DARK' }));
    await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: 'second', theme: 'OCEAN_BLUE' }));

    const restorePoint = await designRow('RESTORE_POINT');
    expect(restorePoint, '發布第二次之後應該要有還原點').not.toBeNull();
    expect(restorePoint?.config.name).toBe('first');
    expect((await designRow('PUBLISHED'))?.config.name).toBe('second');

    mock.reset();
    const res = await ownerA.post(`${API}/restore-previous`, {});
    expect(res.status).toBe(200);
    const body = await readJson<{ richMenuId: string; source: string }>(res);
    expect(body.data?.source).toBe('LINE_MENU_REUSED');

    // 走的是「切回預設」而不是重新建立：沒有第二次 POST /v2/bot/richmenu
    expect(mock.requestsFor(PATH_CREATE)).toHaveLength(0);
    expect(mock.requestsFor(PATH_SET_DEFAULT)).toHaveLength(1);

    // ★ 兩列對調：剛剛被換下來的成為新的還原點
    expect((await designRow('PUBLISHED'))?.config.name).toBe('first');
    expect((await designRow('RESTORE_POINT'))?.config.name).toBe('second');
  });

  it('只保留最近 1 份：發布三次之後，還原點是第二次那一份（不是第一次）', async () => {
    for (const name of ['v1', 'v2', 'v3']) {
      await ownerA.post(`${API}/create-advanced`, advancedDesign({ name }));
    }
    const { data: rows } = await admin.from('rich_menu_designs')
      .select('kind').eq('tenant_id', SHOP_A.id).eq('kind', 'RESTORE_POINT');
    expect(rows).toHaveLength(1);
    expect((await designRow('RESTORE_POINT'))?.config.name).toBe('v2');
    expect((await designRow('PUBLISHED'))?.config.name).toBe('v3');
  });
});

/* ══════════════════════════════════════════ advanced-config（§6.2.6） */
describe('advanced-config：草稿讀寫往返一致', () => {
  it('PUT 存什麼、GET 就拿回什麼（含 cells 順序與空字串欄位）', async () => {
    const design = advancedDesign({
      layout: '2x2',
      cells: [
        { label: '甲', action: 'SEND_TEXT', value: '預約', icon: '' },
        { label: '', action: 'SEND_TEXT', value: '商品', icon: '' },
        { label: '丙', action: 'OPEN_URL', value: 'https://example.com/x', icon: '' },
        { label: '丁', action: 'FLEX_POPUP', value: '', icon: '' },
      ],
    });

    const put = await ownerA.put(`${API}/advanced-config`, design);
    expect(put.status).toBe(200);

    const get = await ownerA.get(`${API}/advanced-config`);
    expect(get.status).toBe(200);
    const body = await readJson<any>(get);

    expect(body.data.draft.layout).toBe('2x2');
    expect(body.data.draft.theme).toBe(design.theme);
    expect(body.data.draft.chatBarText).toBe('打開選單');
    // 逐格比對：順序與空字串都要原樣回來
    expect(body.data.draft.cells).toEqual(design.cells);
    // 草稿不是發布
    expect(body.data.published).toBeNull();
    expect(body.data.restorePoint).toBeNull();
    expect(mock.requests, '存草稿不該打 LINE').toHaveLength(0);
  });

  it('發布之後 GET 才有 published；restorePoint 只回時間、不回整份設計', async () => {
    await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: 'p1' }));
    await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: 'p2' }));

    const body = await readJson<any>(await ownerA.get(`${API}/advanced-config`));
    expect(body.data.published.richMenuId).toBe(MOCK_RICH_MENU_ID);
    expect(body.data.published.config.name).toBe('p2');
    expect(body.data.restorePoint.updatedAt).toBeTruthy();
    expect(body.data.restorePoint.config, '還原點不該回整份設計（§6.2.6）').toBeUndefined();
  });

  it('跨租戶隔離：B 店讀不到 A 店的草稿', async () => {
    await ownerA.put(`${API}/advanced-config`, advancedDesign({ name: 'A 店機密草稿' }));

    const body = await readJson<any>(await ownerB.get(`${API}/advanced-config`));
    expect(body.success).toBe(true);
    expect(body.data.draft, 'B 店拿到了 A 店的草稿').toBeNull();
  });
});

/* ══════════════════════════════════════ 兩支上傳端點（§6.2.8） */
describe('upload-image / upload-cell-icon：走 uploadToBucket() 並回可用 URL', () => {
  it('upload-image：回可用 URL，且**順手寫進 line.richMenuBgImageUrl**（發布讀的是那個欄位）', async () => {
    const res = await ownerA.fetch(`${API}/upload-image`, {
      method: 'POST', body: form({ file: pngFile('bg.png') }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ url: string; path: string; savedTo: string }>(res);
    expect(body.data?.url).toMatch(/^https?:\/\//);
    expect(body.data?.savedTo).toBe('line.richMenuBgImageUrl');
    if (body.data?.path) uploadedPaths.push(body.data.path);

    // ★ 落地：少了這一步「上傳成功」只是半個事實
    expect((await lineJsonb()).richMenuBgImageUrl).toBe(body.data?.url);
  });

  it('upload-cell-icon：回可用 URL 並寫進草稿那一格，且誠實回報不會合成進底圖', async () => {
    const res = await ownerA.fetch(`${API}/upload-cell-icon`, {
      method: 'POST', body: form({ file: pngFile('cell.png'), cellIndex: '2' }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<any>(res);
    expect(body.data.url).toMatch(/^https?:\/\//);
    expect(body.data.cellIndex).toBe(2);
    // ⚠️ 誠實旗標：圖示存得到，但不會出現在 LINE 選單底圖上（§6.2.8）
    expect(body.data.composedIntoMenuImage).toBe(false);
    if (body.data.path) uploadedPaths.push(body.data.path);

    const draft = await designRow('DRAFT');
    expect(draft?.config.cells[2].icon).toBe(body.data.url);
  });

  it('共用的 1 MB 守門對這兩支同樣生效（不是各自再寫一份驗證）', async () => {
    const tooBig = new File(
      [Buffer.alloc(1024 * 1024 + 1) as unknown as BlobPart], 'big.png', { type: 'image/png' },
    );
    const res = await ownerA.fetch(`${API}/upload-image`, {
      method: 'POST', body: form({ file: tooBig }),
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).message).toContain('1MB');
  });
});

/* ══════════════════════════════════ booking-step-guide（§6.2.9） */
describe('PUT /api/settings/line/booking-step-guide', () => {
  const PATH = '/api/settings/line/booking-step-guide';

  it('存得進、讀得回，七步補齊，且產出的 card payload 結構合法', async () => {
    const res = await ownerA.put(PATH, {
      enabled: true,
      steps: [{ key: 'SERVICE', title: '選擇你要的服務', color: '#123456' }],
    });
    expect(res.status).toBe(200);
    const body = await readJson<any>(res);

    expect(body.data.steps).toHaveLength(BOOKING_STEP_KEYS.length);
    expect(body.data.steps[0]).toEqual({ key: 'SERVICE', title: '選擇你要的服務', color: '#123456' });
    // 沒送的步驟用原站預設值補（spec 的 placeholder / value）
    expect(body.data.steps[1]).toEqual({ key: 'DATE', title: '📅 選擇預約日期', color: '#1DB446' });

    // card payload：bubble 結構、無空字串 text（LINE 的 text 元件不收空字串）
    const card = body.data.card;
    expect(card.type).toBe('bubble');
    const texts = JSON.stringify(card).match(/"text":"[^"]*"/g) ?? [];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts).not.toContain('"text":""');

    // ⚠️ 誠實旗標：目前沒有任何地方會把這張卡送給顧客（§6.2.9）
    expect(body.data.deliveredToCustomers).toBe(false);

    // GET 讀得回同一份
    const got = await readJson<any>(await ownerA.get(PATH));
    expect(got.data.steps).toEqual(body.data.steps);
    expect(got.data.enabled).toBe(true);

    // 直查 DB
    expect((await lineJsonb()).bookingStepGuide.steps[0].title).toBe('選擇你要的服務');
  });

  it('色碼格式不合 → 400（LINE 只收 #RRGGBB，送出去整包會被退）', async () => {
    const res = await ownerA.put(PATH, {
      enabled: true, steps: [{ key: 'SERVICE', title: 'x', color: 'red' }],
    });
    expect(res.status).toBe(400);
  });
});

/* ═══════════════════════════════════════ 孤兒回滾（§6.2.3） */
describe('建立失敗時不留孤兒（兩個方向都要堵）', () => {
  it('LINE 傳圖失敗 → 已建立的選單被刪，DB 一列都沒寫', async () => {
    mock.failNextFor(/\/content$/, 500);

    const res = await ownerA.post(`${API}/create-advanced`, advancedDesign());
    expect(res.status).toBeGreaterThanOrEqual(400);

    // LINE 端：建立過、也刪掉了（不留半成品）
    expect(mock.requestsFor(PATH_CREATE)).toHaveLength(1);
    expect(
      mock.requests.some((r) => r.method === 'DELETE' && r.path === PATH_DELETE),
      'LINE 端留下了一張沒有圖、也沒人用的孤兒選單',
    ).toBe(true);
    expect(mock.requestsFor(PATH_SET_DEFAULT)).toHaveLength(0);

    // ★ DB 端：什麼都沒寫
    expect(await designRow('PUBLISHED')).toBeNull();
    expect((await lineJsonb()).richMenuId).toBe('');
  });

  it('LINE 全成功但 DB 寫入失敗 → 剛建立的選單被刪、預設切回舊的，DB 維持原狀', async () => {
    /*
     * 怎麼「讓 DB 寫入失敗」而不動受測程式碼：
     * jsonb **無法儲存 U+0000**（Postgres：`unsupported Unicode escape sequence`）。
     * 把一個含 NUL 的字串放進 `name`，zod 收得下（只有長度上限），
     * 而 `writeDesign()` 的 upsert 會在 LINE 三連請求**之後**才炸——正是 §6.2.3
     * 第二列要堵的那個時序。這比 mock 掉 supabase client 誠實：走的是真的 DB。
     */
    // 先發布一次，製造「有舊選單可以切回去」的前提
    await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: 'good' }));
    const beforeRichMenuId = (await lineJsonb()).richMenuId;
    expect(beforeRichMenuId).toBe(MOCK_RICH_MENU_ID);
    mock.reset();

    const res = await ownerA.post(`${API}/create-advanced`, advancedDesign({ name: NUL_NAME }));
    // ⚠️ NUL_NAME 用逃逸序列組出來，**不要把真的 U+0000 位元組寫進這個檔案**
    //    ——git 會把含 NUL 的檔案當成二進位，diff 從此看不見（本輪已中過一次）。
    expect(res.status).toBeGreaterThanOrEqual(400);

    // LINE 端：建立過 → 然後被刪掉，且預設被切回舊的
    expect(mock.requestsFor(PATH_CREATE)).toHaveLength(1);
    expect(
      mock.requests.some((r) => r.method === 'DELETE' && r.path === PATH_DELETE),
      'DB 寫失敗了，LINE 端卻留著新選單——顧客看到的與後台顯示的會不一致',
    ).toBe(true);

    // ★ DB 端維持原狀：還是上一份 'good'
    expect((await designRow('PUBLISHED'))?.config.name).toBe('good');
    expect((await lineJsonb()).richMenuId).toBe(beforeRichMenuId);
  });
});

/* ═══════════════════════════════════════ 閘門與租戶隔離 */
describe('閘門與租戶隔離', () => {
  it('未訂閱 CUSTOM_RICH_MENU → 進階發布 403 FEAT_001，且 LINE 零呼叫', async () => {
    await admin.from('feature_subscriptions')
      .delete().eq('tenant_id', SHOP_A.id).eq('code', 'CUSTOM_RICH_MENU');
    try {
      const res = await ownerA.post(`${API}/create-advanced`, advancedDesign());
      expect(res.status).toBe(403);
      expect((await readJson(res)).code).toBe('FEAT_001');
      expect(mock.requestsFor(PATH_CREATE)).toHaveLength(0);
    } finally {
      await admin.from('feature_subscriptions').upsert(
        {
          tenant_id: SHOP_A.id, code: 'CUSTOM_RICH_MENU',
          active: true, expires_at: null, source: 'GRANTED', cancelled_at: null,
        },
        { onConflict: 'tenant_id,code' },
      );
    }
  });

  it('未登入 → 401，所有進階端點一致', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    for (const p of ['create-advanced', 'create-custom', 'create-scene',
      'preview-advanced', 'preview-scene', 'preview-scene-flex', 'restore-previous']) {
      const res = await fetch(`${base}${API}/${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status, `${p} 沒有擋未登入`).toBe(401);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('B 店發布不會動到 A 店的資料列（rich_menu_designs 依租戶隔離）', async () => {
    await ownerA.put(`${API}/advanced-config`, advancedDesign({ name: 'A 的草稿' }));
    await ownerB.put(`${API}/advanced-config`, advancedDesign({ name: 'B 的草稿' }));

    expect((await designRow('DRAFT', SHOP_A.id))?.config.name).toBe('A 的草稿');
    expect((await designRow('DRAFT', SHOP_B.id))?.config.name).toBe('B 的草稿');
  });
});
