/**
 * Rich Menu 建立／刪除整合測試 — 12 分冊 §4「Phase 6（LINE）」2026-08-24 補列第一組：
 *   「rich menu：POST /api/settings/line/rich-menu/create → mock LINE 依序收到
 *    建立/傳圖/設預設三個請求、richMenuId 寫回 tenant_settings.line；傳圖失敗時
 *    已建立的選單被刪（無孤兒）；DELETE /api/settings/line/rich-menu → mock 收到
 *    刪除且 jsonb 的 richMenuId 清空；無自訂底圖且 bucket 無主題圖時，退回現生成
 *    純色 PNG 而非 404。」
 *
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §6（①–⑤ 流程、DELETE 冪等、
 * 純色底圖退路）。實作：src/app/api/settings/line/rich-menu/create/route.ts、
 * src/app/api/settings/line/rich-menu/route.ts、src/server/line.ts、src/server/png.ts。
 *
 * 為什麼這一組非有不可：rich menu 的「發布」按鈕曾經是純前端假成功（頁面從沒呼叫
 * 過這支端點），而端點本身零測試——兩層各自看起來沒問題，合起來什麼都沒發生。
 * 見 CLAUDE.md「A success toast is a claim of fact」。
 *
 * 鏈路（同 line-webhook.06）：本測試 process 在固定 port 4123 起假 LINE server；
 * global-setup spawn 的 next dev 讀 .env.test 的 LINE_API_BASE / LINE_DATA_API_BASE
 * 打到這裡。**兩個 base 都要指到 mock**——建立/設預設走 api.line.me，傳圖走
 * api-data.line.me，少設一個就會真的往外打。
 *
 * 底圖的驗證方式（重要）：純色退路那一條**不 import src/server/png.ts**。
 * 拿受測程式自己的產生器當期望值，等於用它證明它自己；這裡改成依 PNG 規格
 * 自行解析上傳的位元組（簽章 → IHDR 寬高/位元深度/色彩型別 → inflate IDAT 讀
 * 第一個像素），期望值是 src/config/rich-menu-themes.ts 的主題色。
 *
 * 清理紀律：本檔只動 SHOP_A 的 tenant_settings（line jsonb 與兩個 *_enc 欄），
 * beforeAll 快照、afterAll 原樣還原；不建立任何業務資料列。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { RICH_MENU_THEME_COLORS } from '@/config/rich-menu-themes';
import { encryptSecret } from '@/server/crypto';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-secret-07-richmenu';
const CHANNEL_TOKEN = 'itest-line-token-07-richmenu';

/** tests/helpers/line-mock.ts 對 POST /v2/bot/richmenu 固定回的 id */
const MOCK_RICH_MENU_ID = 'richmenu-mock-0001';

const PATH_CREATE = '/v2/bot/richmenu';
const PATH_UPLOAD = `/v2/bot/richmenu/${MOCK_RICH_MENU_ID}/content`;
const PATH_SET_DEFAULT = `/v2/bot/user/all/richmenu/${MOCK_RICH_MENU_ID}`;
const PATH_DELETE = `/v2/bot/richmenu/${MOCK_RICH_MENU_ID}`;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

/** 目前 tenant_settings.line jsonb */
async function lineJsonb(): Promise<Record<string, any>> {
  const { data, error } = await admin.from('tenant_settings')
    .select('line').eq('tenant_id', SHOP_A.id).single();
  expect(error).toBeNull();
  return (data?.line ?? {}) as Record<string, any>;
}

/** 直接把 line jsonb 換成指定內容（案例前置條件用） */
async function setLineJsonb(next: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('tenant_settings')
    .update({ line: next }).eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

/* ------------------------------------------------------------------ PNG 解析
 * 依 PNG 規格（RFC 2083）自行解析，不碰 src/server/png.ts —— 見檔頭說明。 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePng(buf: Buffer): {
  width: number; height: number; bitDepth: number; colorType: number;
  firstPixel: [number, number, number];
} {
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

  let offset = 8;
  let ihdr: Buffer | null = null;
  const idatParts: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    if (type === 'IDAT') idatParts.push(Buffer.from(data));
    if (type === 'IEND') break;
    offset += 12 + length;   // 4 長度 + 4 型別 + data + 4 CRC
  }
  if (!ihdr) throw new Error('上傳的位元組裡沒有 IHDR chunk，不是合法 PNG');

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  // 掃描列格式：每列開頭 1 byte filter type，之後 width×3 bytes（truecolor 8-bit）
  const raw = inflateSync(Buffer.concat(idatParts));
  return {
    width,
    height,
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    firstPixel: [raw[1], raw[2], raw[3]],
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`主題色格式非預期：${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE || !process.env.LINE_DATA_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE / LINE_DATA_API_BASE：本檔需要兩者都設成 ' +
      'http://localhost:4123（.env.test 或 CI env）。傳圖走 api-data.line.me，' +
      '只設一個的話那一步會往真 LINE 打。',
    );
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
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
});

afterAll(async () => {
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line,
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

beforeEach(async () => {
  mock.reset();
  // 每個案例都從「已設定 channelId、沒有自訂底圖、沒有已發布選單」起跑
  await setLineJsonb({ channelId: '2005459361', richMenuId: '', richMenuBgImageUrl: '' });
});

describe('POST /api/settings/line/rich-menu/create（06 §6 ①–⑤）', () => {
  it('建立 → 傳圖 → 設預設：mock LINE 依序收到三個請求，richMenuId 寫回 tenant_settings.line', async () => {
    const res = await ownerA.post('/api/settings/line/rich-menu/create', { theme: 'OCEAN_BLUE' });
    expect(res.status).toBe(200);
    const body = await readJson<{ richMenuId: string }>(res);
    expect(body.success).toBe(true);
    expect(body.data?.richMenuId).toBe(MOCK_RICH_MENU_ID);

    // ---- 三連請求，順序也要對（傳圖必須在建立之後、設預設之前）----
    const paths = mock.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual([
      `POST ${PATH_CREATE}`,
      `POST ${PATH_UPLOAD}`,
      `POST ${PATH_SET_DEFAULT}`,
    ]);

    // ① 建立請求的選單設定：2500×1686、六格
    const create = mock.requestsFor(PATH_CREATE)[0];
    expect(create.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(create.body.size).toEqual({ width: 2500, height: 1686 });
    expect(create.body.areas).toHaveLength(6);
    expect(create.body.areas[0].bounds).toEqual({ x: 0, y: 0, width: 833, height: 843 });
    for (const area of create.body.areas) expect(area.action).toBeTruthy();

    // ③ 傳圖請求帶的是圖片，不是 JSON
    const upload = mock.requestsFor(PATH_UPLOAD)[0];
    expect(String(upload.headers['content-type'])).toMatch(/^image\/(png|jpeg)$/);
    expect(upload.rawBuffer.length).toBeGreaterThan(0);

    // ⑤ 落庫：richMenuId 與這次指定的主題都寫進 line jsonb，且密文欄沒被寫進 jsonb
    const line = await lineJsonb();
    expect(line.richMenuId).toBe(MOCK_RICH_MENU_ID);
    expect(line.richMenuTheme).toBe('OCEAN_BLUE');
    expect(line.channelId).toBe('2005459361');   // 既有欄位保留
    expect(line.channelSecret).toBeUndefined();
    expect(line.channelAccessToken).toBeUndefined();
  });

  it('無自訂底圖且 bucket 無主題圖 → 退回現生成的純色 PNG（不是 404）', async () => {
    // 前置條件要驗，不能假設：bucket 真的沒有這個主題的底圖，退路才是被走到的那條
    const theme = 'ROYAL_PURPLE';
    for (const ext of ['png', 'jpg']) {
      const { data } = await admin.storage.from('richmenu-assets').download(`themes/${theme}.${ext}`);
      expect(data).toBeNull();
    }
    expect((await lineJsonb()).richMenuBgImageUrl).toBe('');

    const res = await ownerA.post('/api/settings/line/rich-menu/create', { theme });
    expect(res.status).toBe(200);                      // ← 舊行為是 404「找不到底圖」

    const upload = mock.requestsFor(PATH_UPLOAD)[0];
    expect(upload).toBeTruthy();
    expect(upload.headers['content-type']).toBe('image/png');

    const png = parsePng(upload.rawBuffer);
    expect(png.width).toBe(2500);
    expect(png.height).toBe(1686);
    expect(png.bitDepth).toBe(8);
    expect(png.colorType).toBe(2);                     // truecolor
    expect(png.firstPixel).toEqual(hexToRgb(RICH_MENU_THEME_COLORS[theme].bg));
  });

  it('傳圖失敗 → 剛建立的選單被刪掉（LINE 端不留孤兒）、不設預設、richMenuId 不落庫', async () => {
    mock.failNextFor(PATH_UPLOAD, 500);

    const res = await ownerA.post('/api/settings/line/rich-menu/create', { theme: 'LINE_GREEN' });
    expect(res.status).toBe(502);                      // lineFetch → ApiHttpError(502)
    expect((await readJson(res)).code).toBe('LINE_002');

    const paths = mock.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual([
      `POST ${PATH_CREATE}`,
      `POST ${PATH_UPLOAD}`,     // 失敗的那一個
      `DELETE ${PATH_DELETE}`,   // ← 清孤兒
    ]);
    expect(mock.requestsFor(PATH_SET_DEFAULT)).toHaveLength(0);

    // 失敗就不該留下任何「已發布」的痕跡
    expect((await lineJsonb()).richMenuId).toBe('');
  });

  it('未設定 LINE Channel Token → 400 LINE_001，且一個 LINE 請求都不發', async () => {
    const { error } = await admin.from('tenant_settings')
      .update({ line_channel_access_token_enc: '' }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    try {
      const res = await ownerA.post('/api/settings/line/rich-menu/create', { theme: 'LINE_GREEN' });
      expect(res.status).toBe(400);
      expect((await readJson(res)).code).toBe('LINE_001');
      expect(mock.requests).toHaveLength(0);
    } finally {
      await admin.from('tenant_settings')
        .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN) })
        .eq('tenant_id', SHOP_A.id);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/settings/line/rich-menu/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('DELETE /api/settings/line/rich-menu（06 §6）', () => {
  it('已發布 → mock LINE 收到 DELETE，且 jsonb 的 richMenuId 被清空', async () => {
    await setLineJsonb({ channelId: '2005459361', richMenuId: MOCK_RICH_MENU_ID, richMenuTheme: 'DARK' });

    const res = await ownerA.delete('/api/settings/line/rich-menu');
    expect(res.status).toBe(200);
    expect((await readJson<{ deleted: boolean }>(res)).data?.deleted).toBe(true);

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([`DELETE ${PATH_DELETE}`]);
    expect(mock.requestsFor(PATH_DELETE)[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);

    const line = await lineJsonb();
    expect(line.richMenuId).toBe('');
    expect(line.richMenuTheme).toBe('DARK');           // 其他欄位不受影響
  });

  it('沒有已發布選單 → 冪等回成功，且不打 LINE', async () => {
    const res = await ownerA.delete('/api/settings/line/rich-menu');
    expect(res.status).toBe(200);
    expect((await readJson<{ deleted: boolean }>(res)).data?.deleted).toBe(true);
    expect(mock.requests).toHaveLength(0);
    expect((await lineJsonb()).richMenuId).toBe('');
  });
});
