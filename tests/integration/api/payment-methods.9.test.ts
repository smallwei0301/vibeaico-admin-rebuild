/**
 * 收款方式端點：真的存得住、真的隔離、真的不外流金流欄位 — issue #9 第一＋二步
 * -----------------------------------------------------------------------------
 * 修好前的病：`/tenant/payment-methods` 是**整頁假的**。`load()` 用
 * `setTimeout(320)` 假裝網路延遲之後讀頁內的 `MOCK_METHODS`，新增／編輯／啟停／
 * 刪除全部只改本地 state 再跳一個成功 toast；而且它**不是** `adapt()` 的 mock
 * 分支，所以不受 `NEXT_PUBLIC_USE_MOCK` 影響——正式站上跑的也是那一段。店家設定
 * 完收款方式、看到「已更新」，重新整理就全部消失。`src/app/api` 底下沒有任何
 * payment 路由，`src/services` 底下沒有任何 payment 檔案。
 *
 * 本檔打真端點、直查 DB，驗的是「存得住」這件事本身：
 *   1. GET 讀得到種子那筆，且**回傳不含任何 gateway 欄位**
 *      （對照組：同一列直查 DB，證明那些欄位真的在表上、真的有值——
 *       「端點沒回」不是因為「欄位不存在」）
 *   2. POST 建立 → 直查 DB 確認五個 config 欄位真的落地 → GET 看得到
 *   3. sort_order 接在最大值之後：刪掉中間一筆再新增，不會撞號
 *      （用 count 當新序號就會撞——這是實作刻意避開的坑）
 *   4. PUT 局部更新只動指定欄位；空 body 回 200 而**不是** 404（#294 的坑）
 *   5. PUT 把銀行帳號清成空字串，DB 真的變空（不是被「有值才送」過濾掉）
 *   6. DELETE 之後 DB 真的沒了；重複 DELETE 回 404
 *   7. 跨租戶：B 店帳號拿 A 店 id 做 PUT／DELETE 回 404，且 A 店那列**一個字沒動**
 *   8. 角色：STAFF 讀得到、寫不了（403）
 *   9. ONLINE_PAYMENT 建得起來，但端點一樣不吐 gateway 欄位——第三步（藍新／綠界）
 *      還沒有實作也還沒有憑證，UI 誠實標示尚未開通
 *
 * 清理紀律：afterAll 刪掉本檔造出的所有列（以 display_name 前綴辨識），
 * 並把種子那筆 `SHOP_A.pmBankTransfer` 還原成 beforeAll 拍下的快照。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const PATH = '/api/payment-methods';

/** 本檔造出的資料一律帶這個前綴，afterAll 靠它清乾淨，也避免與其他測試檔互踩。 */
const TAG = 'itest9-';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

interface ApiRow {
  id: string;
  methodType: string;
  displayName: string;
  qrImageUrl: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  instructions: string;
  active: boolean;
  sortOrder: number;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let staffA: AuthedApi;
/** 種子那筆的原始內容，afterAll 用來還原。 */
let seedSnapshot: Record<string, unknown> | null = null;

const body = (over: Partial<Record<string, unknown>> = {}) => ({
  methodType: 'BANK_TRANSFER',
  displayName: `${TAG}銀行轉帳`,
  qrImageUrl: '',
  config: {
    bankName: '國泰世華', bankCode: '013', accountNumber: '1234567890',
    accountHolderName: '王小明', instructions: '匯款後請告知後五碼',
  },
  active: true,
  ...over,
});

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** 直查 DB 拿整列（含 gateway 欄位），繞過端點的白名單。 */
async function dbRow(id: string) {
  const { data, error } = await admin
    .from('tenant_payment_methods').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`直查 tenant_payment_methods 失敗：${error.message}`);
  return data as Record<string, unknown> | null;
}

/** 建一筆，回 id。失敗就把整個信封丟出來，不讓「沒建成」偽裝成後面的斷言失敗。 */
async function create(api: AuthedApi, over: Partial<Record<string, unknown>> = {}) {
  const res = await api.post(PATH, body(over));
  const env = await readJson<{ id: string }>(res);
  if (res.status !== 200 || !env.success || !env.data?.id)
    throw new Error(`建立失敗（${res.status}）：${JSON.stringify(env)}`);
  return env.data.id;
}

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
  staffA = await loginAs(STAFF_A2.email, STAFF_A2.password);
  seedSnapshot = await dbRow(SHOP_A.pmBankTransfer);
});

afterAll(async () => {
  await admin.from('tenant_payment_methods').delete().like('display_name', `${TAG}%`);
  if (seedSnapshot) {
    await admin.from('tenant_payment_methods')
      .upsert(seedSnapshot, { onConflict: 'id' });
  }
});

describe('GET /api/payment-methods', () => {
  it('讀得到種子那筆，且欄位對得上 DB', async () => {
    const res = await ownerA.get(PATH);
    expect(res.status).toBe(200);
    const env = await readJson<ApiRow[]>(res);
    expect(env.success).toBe(true);
    const seed = env.data!.find((r) => r.id === SHOP_A.pmBankTransfer);
    expect(seed, '種子的 tenant_payment_methods 那筆沒有出現在列表裡').toBeDefined();
    expect(seed!.methodType).toBe('BANK_TRANSFER');
    expect(seed!.bankName).toBe((seedSnapshot!.config as Record<string, string>).bankName);
  });

  /**
   * ⚠️ 這一條的對照組很重要。
   *
   * 端點用白名單 `PAYMENT_METHOD_COLUMNS` 而不是 `select('*')`，所以資料表上任何
   * 不在白名單裡的欄位都不會被吐出去。共用 TEST 上這張表還帶著一條未合併分支留下
   * 的四個 gateway 欄位（`gateway_merchant_id`、`gateway_hash_key_enc`、
   * `gateway_hash_iv_enc`、`gateway_verified_at`）——`0094` 刻意沒有建立它們，
   * 也沒有刪除它們（清理屬 #197）。
   *
   * 但「回應裡沒有 gateway」單獨看是**恆真的**：那些欄位在一個依 repo migration
   * 重建的資料庫上根本不存在，這條照樣綠。所以對照組不押在 gateway 上，而押在
   * `updated_at`——那是 `0094` 保證存在、且刻意不在白名單裡的欄位。先證明「端點
   * 回的欄位確實比資料表少」，再證明少掉的裡面包含所有 gateway 欄位。
   */
  it('回應只有白名單欄位：資料表有而端點沒有的裡面包含 updated_at 與所有 gateway 欄位', async () => {
    const id = await create(ownerA, { displayName: `${TAG}白名單` });

    const raw = await dbRow(id);
    expect(raw, '建立失敗，這條測試等於在比對一個不存在的列').toBeTruthy();

    const env = await readJson<ApiRow[]>(await ownerA.get(PATH));
    const row = env.data!.find((r) => r.id === id);
    expect(row, '剛建立的那筆沒有出現在列表裡').toBeDefined();

    const dbKeys = Object.keys(raw!);
    const apiKeys = new Set(Object.keys(row!));
    const hidden = dbKeys.filter((k) => !apiKeys.has(k) && !apiKeys.has(camel(k)));

    // 對照組：端點必須真的比資料表窄。`updated_at` 由 `0094` 的檔尾斷言保證存在。
    expect(dbKeys, '0094 沒有建立 updated_at？').toContain('updated_at');
    expect(hidden, "端點把資料表整列吐出去了（很可能被改回 select('*')）")
      .toContain('updated_at');

    // 真正要證的：資料表上凡是 gateway 欄位，一個都沒被回出去。
    const gatewayInDb = dbKeys.filter((k) => k.startsWith('gateway_'));
    for (const k of gatewayInDb) expect(hidden).toContain(k);
    expect(Object.keys(row!).filter((k) => k.toLowerCase().includes('gateway'))).toEqual([]);
  });
});

describe('POST：真的寫進資料庫', () => {
  it('五個 config 欄位逐一落地，重新 GET 讀得回來', async () => {
    const id = await create(ownerA, { displayName: `${TAG}落地驗證` });

    const raw = await dbRow(id);
    expect(raw, 'POST 回了 200 但 DB 裡查不到那一列').toBeTruthy();
    expect(raw!.tenant_id).toBe(SHOP_A.id);
    expect(raw!.method_type).toBe('BANK_TRANSFER');
    expect(raw!.display_name).toBe(`${TAG}落地驗證`);
    expect(raw!.config).toEqual({
      bankName: '國泰世華', bankCode: '013', accountNumber: '1234567890',
      accountHolderName: '王小明', instructions: '匯款後請告知後五碼',
    });

    const env = await readJson<ApiRow[]>(await ownerA.get(PATH));
    const row = env.data!.find((r) => r.id === id)!;
    expect(row.accountNumber).toBe('1234567890');
    expect(row.instructions).toBe('匯款後請告知後五碼');
  });

  /**
   * ⚠️ 用 `count` 當新的 sort_order 會在刪除後撞號：刪掉中間一筆，count 變小，
   * 下一筆就撞上既有的尾端。實作讀的是實際最大值，這條就是驗那件事。
   */
  it('sort_order 接在最大值之後：刪掉中間一筆再新增也不撞號', async () => {
    const a = await create(ownerA, { displayName: `${TAG}序號A` });
    const b = await create(ownerA, { displayName: `${TAG}序號B` });
    const c = await create(ownerA, { displayName: `${TAG}序號C` });
    const orderOf = async (id: string) => Number((await dbRow(id))!.sort_order);
    const [oa, ob, oc] = [await orderOf(a), await orderOf(b), await orderOf(c)];
    // 對照組：三筆本來就必須是遞增的，否則下面比大小沒有意義。
    expect(ob).toBeGreaterThan(oa);
    expect(oc).toBeGreaterThan(ob);

    expect((await ownerA.delete(`${PATH}/${b}`)).status).toBe(200);
    const d = await create(ownerA, { displayName: `${TAG}序號D` });
    const od = await orderOf(d);
    expect(od, '刪掉中間一筆之後新增，序號撞上既有的尾端').toBeGreaterThan(oc);
  });

  it('displayName 空字串會被擋下（zod min(1)）', async () => {
    const res = await ownerA.post(PATH, body({ displayName: '' }));
    expect(res.status).toBe(400);
  });

  it('未定義的 methodType 會被擋下', async () => {
    const res = await ownerA.post(PATH, body({ methodType: 'BITCOIN' }));
    expect(res.status).toBe(400);
  });
});

describe('PUT：局部更新，且空 patch 不會被誤判成 404', () => {
  it('只送 displayName 時，其他欄位一個字都沒動', async () => {
    const id = await create(ownerA, { displayName: `${TAG}改名前` });
    const before = await dbRow(id);

    const res = await ownerA.put(`${PATH}/${id}`, { displayName: `${TAG}改名後` });
    expect(res.status).toBe(200);

    const after = await dbRow(id);
    expect(after!.display_name).toBe(`${TAG}改名後`);
    expect(after!.config).toEqual(before!.config);
    expect(after!.qr_image_url).toBe(before!.qr_image_url);
    expect(after!.active).toBe(before!.active);
    expect(after!.sort_order).toBe(before!.sort_order);
  });

  /**
   * #294 在 `PUT /api/trip-departures/:id` 上踩過的坑：PostgREST 對空的 update
   * 影響 0 列，`maybeSingle()` 回 null，於是「沒有任何欄位要改」被誤判成
   * 「查無此資源」而回 404。
   *
   * ⚠️ 誠實說明這條測試證明到哪裡（2026-09-09 最終風險評估 MINOR-4）：
   * 本端點在空 patch 守衛之後才加上 `patch.updated_at`，所以**即使把守衛拿掉**，
   * update 仍會影響 1 列而回 200——這條測試因此**證不到守衛本身有用**，
   * 把守衛改成 `if (false)` 它照樣綠。它證的是「空 body 的對外行為是 200 而不是
   * 404」，那個對外契約本身仍值得鎖。守衛留著的實益只有一個：避免為了一個什麼
   * 都沒改的請求去動 `updated_at`。不誇大成「它擋住了 #294」。
   */
  it('空 body 的對外行為是 200（不是 404）；不存在的 id 才回 404', async () => {
    const id = await create(ownerA, { displayName: `${TAG}空patch` });
    const empty = await ownerA.put(`${PATH}/${id}`, {});
    expect(empty.status, '空 body 被誤判成查無此資源').toBe(200);

    // 對照組：真的不存在時必須是 404，否則上面那條只是因為端點永遠回 200。
    const missing = await ownerA.put(`${PATH}/00000000-0000-4000-8000-0000000009ff`, {});
    expect(missing.status).toBe(404);
  });

  it('把銀行帳號清成空字串，DB 真的變空（不是被過濾掉）', async () => {
    const id = await create(ownerA, { displayName: `${TAG}清空` });
    expect((await dbRow(id))!.config).toMatchObject({ accountNumber: '1234567890' });

    const res = await ownerA.put(`${PATH}/${id}`, {
      config: {
        bankName: '', bankCode: '', accountNumber: '',
        accountHolderName: '', instructions: '',
      },
    });
    expect(res.status).toBe(200);
    expect((await dbRow(id))!.config).toEqual({
      bankName: '', bankCode: '', accountNumber: '',
      accountHolderName: '', instructions: '',
    });
  });

  /**
   * 表單上的排序欄位第一版根本送不出去（`toApiPayload` 把 `sortOrder` `Omit` 掉），
   * 於是「填了、按儲存、跳已更新、重整跳回舊值」——這一頁原本那種假成功縮小到
   * 一個欄位。由 2026-09-09 的最終風險評估抓出（MAJOR-1）。
   * 這裡驗端點這一側：送得進來就一定存得住。
   */
  it('PUT 明確指定 sortOrder 時，DB 真的改成那個值', async () => {
    const id = await create(ownerA, { displayName: `${TAG}排序`, sortOrder: 3 });
    expect(Number((await dbRow(id))!.sort_order), 'POST 帶的 sortOrder 沒有落地').toBe(3);

    expect((await ownerA.put(`${PATH}/${id}`, { sortOrder: 41 })).status).toBe(200);
    expect(Number((await dbRow(id))!.sort_order), 'PUT 的 sortOrder 沒有落地').toBe(41);

    const env = await readJson<ApiRow[]>(await ownerA.get(PATH));
    expect(env.data!.find((r) => r.id === id)!.sortOrder).toBe(41);
  });

  it('停用之後 active 真的變 false', async () => {
    const id = await create(ownerA, { displayName: `${TAG}停用` });
    expect((await ownerA.put(`${PATH}/${id}`, { active: false })).status).toBe(200);
    expect((await dbRow(id))!.active).toBe(false);
  });
});

describe('DELETE', () => {
  it('刪掉之後 DB 真的沒了，重複刪回 404', async () => {
    const id = await create(ownerA, { displayName: `${TAG}待刪` });
    expect((await dbRow(id)), '建立失敗，這條測試等於在刪一個不存在的東西').toBeTruthy();

    expect((await ownerA.delete(`${PATH}/${id}`)).status).toBe(200);
    expect(await dbRow(id)).toBeNull();
    expect((await ownerA.delete(`${PATH}/${id}`)).status).toBe(404);
  });
});

describe('跨租戶隔離', () => {
  it('B 店帳號拿 A 店的 id 做 PUT／DELETE 都回 404，且 A 店那列沒被動到', async () => {
    const id = await create(ownerA, { displayName: `${TAG}隔離` });
    const before = await dbRow(id);

    // 對照組：B 店自己的列表要能正常讀，證明 ownerB 這個 session 是活的，
    // 404 不是因為它根本沒登入成功。
    expect((await ownerB.get(PATH)).status).toBe(200);

    expect((await ownerB.put(`${PATH}/${id}`, { displayName: 'B 店亂改' })).status).toBe(404);
    expect((await ownerB.delete(`${PATH}/${id}`)).status).toBe(404);

    const after = await dbRow(id);
    expect(after, 'B 店把 A 店的資料刪掉了').toBeTruthy();
    expect(after).toEqual(before);
  });

  it('B 店的 GET 看不到 A 店的收款方式', async () => {
    const env = await readJson<ApiRow[]>(await ownerB.get(PATH));
    expect(env.success).toBe(true);
    expect(env.data!.some((r) => r.id === SHOP_A.pmBankTransfer)).toBe(false);
  });
});

describe('角色：STAFF 讀得到、寫不了', () => {
  it('GET 200', async () => {
    expect((await staffA.get(PATH)).status).toBe(200);
  });

  it('POST／PUT／DELETE 都是 403', async () => {
    expect((await staffA.post(PATH, body({ displayName: `${TAG}staff` }))).status).toBe(403);
    expect((await staffA.put(`${PATH}/${SHOP_A.pmBankTransfer}`, { displayName: 'x' })).status).toBe(403);
    expect((await staffA.delete(`${PATH}/${SHOP_A.pmBankTransfer}`)).status).toBe(403);
    // 對照組：擋下之後種子那筆必須原封不動。
    expect((await dbRow(SHOP_A.pmBankTransfer))!.display_name)
      .toBe(seedSnapshot!.display_name);
  });
});

describe('線上刷卡：建得起來，但沒有任何金流欄位', () => {
  /**
   * 第三步（藍新／綠界）還沒有實作也還沒有憑證。店家仍可先把「線上刷卡付款」
   * 列出來，但端點不存也不吐任何 gateway 欄位——原本頁面上那顆「實刷測試並開通」
   * 只是把本地 state 的 `gatewayVerified` 設成 true 再跳成功 toast，沒有打過任何
   * 金流 API。
   */
  it('ONLINE_PAYMENT 可建立，回傳欄位與其他類型一致且不含 gateway', async () => {
    const id = await create(ownerA, {
      methodType: 'ONLINE_PAYMENT',
      displayName: `${TAG}線上刷卡`,
      config: {
        bankName: '', bankCode: '', accountNumber: '',
        accountHolderName: '', instructions: '',
      },
    });
    const env = await readJson<ApiRow[]>(await ownerA.get(PATH));
    const row = env.data!.find((r) => r.id === id)!;
    expect(row, '線上刷卡那筆沒有出現在列表裡').toBeDefined();
    expect(row.methodType).toBe('ONLINE_PAYMENT');
    expect(Object.keys(row).sort()).toEqual([
      'accountHolderName', 'accountNumber', 'active', 'bankCode', 'bankName',
      'displayName', 'id', 'instructions', 'methodType', 'qrImageUrl', 'sortOrder',
    ]);
  });
});
