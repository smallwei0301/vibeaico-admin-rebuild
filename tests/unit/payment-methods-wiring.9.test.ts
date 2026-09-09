/**
 * 收款方式頁的接線不可回歸測試（GitHub issue #9 第二步驗收）
 * -----------------------------------------------------------------------------
 * 修改前：`/tenant/payment-methods` 整頁假的——`load()` 用 `setTimeout(320)` 假裝
 * 網路延遲，然後讀頁內的 `MOCK_METHODS`；新增／編輯／啟停／刪除全部只改本地
 * state 再跳成功 toast。而且它不是 `adapt()` 的 mock 分支，所以 **正式站上也是
 * 那一段** ——店家設定完收款方式、看到「已更新」，重新整理就全部消失。
 *
 * 最嚴重的是「線上刷卡」：原本有一顆「實刷測試並開通」按鈕，按下去就把
 * `gatewayVerified` 設成 true、畫面顯示「已驗證開通」，但**一次金流呼叫都沒
 * 發生**——店家會據此誤判可以開始收錢。這一輪把線上刷卡改成誠實標示「尚未
 * 開通」，其餘五種線下收款方式接上真實後端
 * （`0094` migration ＋ `/api/payment-methods` ＋
 * `src/services/payment-methods.ts`）。
 *
 * ## 這個檔證得到什麼、證不到什麼
 *
 * 它讀的是**原始碼文字**（字串／正規表示式比對原始檔案內容），不是把元件
 * render 出來跑一遍。本專案沒有安裝 @testing-library/react，vitest 單元測試
 * 跑在 node 環境（vitest.config.mts: environment: 'node'），無法掛載 React
 * 元件，也就無法讓這裡的測試真的模擬「使用者點擊儲存 → 畫面顯示新資料」。
 *
 * 這裡鎖的是**靜態不變條件**：頁面是否還 import／呼叫著假成功年代留下的痕跡
 * （MOCK_METHODS、setTimeout、gatewayVerified…），以及四個 CRUD 動作是否真的
 * 呼叫了對應的 service 函式、service 是否真的走 `adapt()` 打對應路徑、端點
 * 是否用白名單欄位而非 `select('*')`。
 *
 * 「頁面存了收款方式 → 之後真的能從後端讀回同一筆」這種**行為**層級的正確性，
 * 由 `tests/integration/api/payment-methods.9.test.ts`（打真實 TEST Supabase）
 * 負責，本檔不涉及、也證不到。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/app/tenant/payment-methods/page.tsx';
const SERVICE = 'src/services/payment-methods.ts';
const SERVER_SHARED = 'src/server/payment-methods.ts';
const ROUTE_COLLECTION = 'src/app/api/payment-methods/route.ts';
const ROUTE_ITEM = 'src/app/api/payment-methods/[id]/route.ts';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明文字被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取出某個 const 箭頭函式／函式的函式體（到下一個頂層 `  const ` 為止） */
function handlerBody(code: string, name: string): string {
  const start = code.indexOf(`const ${name} =`);
  expect(start, `頁面找不到 handler：${name}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.indexOf('\n  const ');
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('payment-methods 頁：不得再有假成功的痕跡（issue #9）', () => {
  const code = withoutComments(src(PAGE));

  // 拿掉這條：有人把假資料常數抄回頁面也不會被抓到，等於整頁 CRUD 又退回本地 state。
  it('頁內不再有 MOCK_METHODS', () => {
    expect(code).not.toMatch(/MOCK_METHODS/);
    // 對照組：清單改讀 services 匯出的 listPaymentMethods，證明「不再有 MOCK_METHODS」
    // 不是因為整段程式都被砍空了。
    expect(code).toMatch(/listPaymentMethods/);
  });

  // 拿掉這條：有人把 `setTimeout(..., 320)` 抄回 load() 也測不出來，
  // 退回「看起來在等網路、其實只是等一個計時器」的假成功。
  it('頁內不再有 setTimeout（假網路延遲的典型手法）', () => {
    expect(code).not.toMatch(/setTimeout/);
    // 對照組：load() 真的用 await 呼叫 service，而不是完全沒有非同步流程。
    expect(handlerBody(code, 'load')).toMatch(/await listPaymentMethods\(/);
  });

  // 拿掉這條：有人把「實刷測試並開通」那顆按鈕的假驗證邏輯抄回來，
  // 店家又會在沒有任何金流呼叫的情況下看到「已驗證開通」。
  it('頁內不再有 gatewayVerified', () => {
    expect(code).not.toMatch(/gatewayVerified/);
    // 對照組：線上刷卡改用誠實標示 t.onlineNotReady，證明這一段邏輯真的還在、
    // 只是換成了誠實版本，不是整塊 ONLINE_PAYMENT 分支被刪掉了。
    expect(code).toMatch(/t\.onlineNotReady/);
  });

  // 拿掉這條：有人把「實刷測試成功」的訊息鍵抄回來，即使按鈕邏輯改了，
  // 文案字典裡殘留的鍵仍可能被某個角落引用回去。
  it('頁內不再有 t.testCharge.success', () => {
    expect(code).not.toMatch(/t\.testCharge\.success/);
  });
});

describe('payment-methods 頁：四個動作真的打 services，頁面自己零 fetch（CLAUDE.md「頁面永不 fetch」）', () => {
  const code = withoutComments(src(PAGE));

  // 拿掉這條：光靠下面各動作的呼叫斷言還是可能誤判——名字可能是頁面自己
  // 重新定義的同名 local 函式，而不是真的接到後端。
  it('頁面確實從 @/services import 五個名字', () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\blistPaymentMethods\b[^}]*\}\s*from\s*'@\/services'/s,
    );
    for (const fn of ['createPaymentMethod', 'updatePaymentMethod', 'setPaymentMethodActive', 'deletePaymentMethod']) {
      expect(code, `頁面沒有從 @/services import ${fn}`).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*'@/services'`, 's'),
      );
    }
  });

  it.each([
    ['load（載入清單）', 'load', 'listPaymentMethods'],
    ['toggleActive（啟停）', 'toggleActive', 'setPaymentMethodActive'],
  ])('%s 呼叫 %s', (_label, handler, fn) => {
    expect(handlerBody(code, handler), `${handler} 沒有呼叫 ${fn}`).toMatch(
      new RegExp(`await ${fn}\\(`),
    );
  });

  // 拿掉這條：兩個分支有一邊悄悄退回 setState 也不會被發現，
  // 變成「編輯看起來成功、其實只有畫面在騙人」。
  it('新增/編輯 modal 的 onSaved：isEdit 分支呼叫 updatePaymentMethod、非 isEdit 分支呼叫 createPaymentMethod', () => {
    const start = code.indexOf('onSaved={async (draft, isEdit)');
    expect(start, '頁面找不到 onSaved handler').toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('/>', code.indexOf('onClose={() => setDeleteTarget(null)}')));
    expect(body).toMatch(/await updatePaymentMethod\(/);
    expect(body).toMatch(/await createPaymentMethod\(/);
  });

  // 拿掉這條：刪除按鈕可能只是把那一列從 rows state 濾掉，重新整理又會出現。
  it('刪除確認 modal 的 onConfirm 呼叫 deletePaymentMethod', () => {
    const start = code.indexOf('onConfirm={async () => {');
    // onConfirm 在刪除 modal（ConfirmModal）那一段裡
    const deleteBlockStart = code.indexOf('ConfirmModal');
    const block = code.slice(deleteBlockStart, code.length);
    expect(start, '頁面找不到刪除的 onConfirm').toBeGreaterThan(-1);
    expect(block).toMatch(/await deletePaymentMethod\(/);
  });

  // 拿掉這條：有人在頁面裡直接打 API 也測不出來，architecture 的單一資料入口保證就破了。
  it('頁面自己不得出現 fetch( 或 \'/api/', () => {
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/'\/api\//);
    // 對照組：services 檔本身是允許出現 /api/ 路徑的地方——證明我們沒有把
    // 「頁面用到 services」這件事本身也一起擋掉。
    expect(withoutComments(src(SERVICE))).toMatch(/'\/api\//);
  });
});

describe('services/payment-methods.ts：每個對外函式都走 adapt() 打真實路徑（issue #9）', () => {
  const code = withoutComments(src(SERVICE));

  it.each([
    ['listPaymentMethods', "'/api/payment-methods'"],
    ['createPaymentMethod', "'/api/payment-methods'"],
    ['updatePaymentMethod', '`/api/payment-methods/${id}`'],
    ['setPaymentMethodActive', '`/api/payment-methods/${id}`'],
    ['deletePaymentMethod', '`/api/payment-methods/${id}`'],
    // 拿掉這條：服務層可能繞過 adapt() 直接 fetch，NEXT_PUBLIC_USE_MOCK
    // 切換就會失效，正式站又變回假資料分支。
  ])('%s 用 adapt() 且真實分支打 %s', (fn, path) => {
    const body = handlerBody(code, fn);
    expect(body, `${fn} 沒有走 adapt(`).toMatch(/adapt</);
    expect(body, `${fn} 的真實分支沒有打 ${path}`).toContain(path);
  });
});

describe('端點不得用 select(\'*\')（CLAUDE.md／server 註解：白名單欄位，避免新欄位／祕密欄位被自動吐出去）', () => {
  // 拿掉這條：有人為了省事把 GET 改回 select('*')，日後任何新加的祕密欄位——
  // 包括第三步的金流憑證——都會原封不動吐給前端。
  it('collection route（GET/POST）用 PAYMENT_METHOD_COLUMNS 白名單常數讀清單，不是 select(\'*\')', () => {
    const code = withoutComments(src(ROUTE_COLLECTION));
    expect(code).not.toMatch(/select\(\s*['"]\*['"]\s*\)/);
    // 對照組：真的有用白名單常數，不是「select 整段被刪掉了」。
    expect(code).toMatch(/\.select\(PAYMENT_METHOD_COLUMNS\)/);
  });

  // 拿掉這條：單筆更新／刪除回傳的資料可能夾帶白名單以外的欄位。
  it('item route（PUT/DELETE）也不得出現 select(\'*\')', () => {
    const code = withoutComments(src(ROUTE_ITEM));
    expect(code).not.toMatch(/select\(\s*['"]\*['"]\s*\)/);
    // 對照組：這支 route 確實還有 .select( 呼叫（只是只選 id），不是整段刪掉。
    expect(code).toMatch(/\.select\('id'\)/);
  });

  // 拿掉這條：就算呼叫端維持 `.select(PAYMENT_METHOD_COLUMNS)`，只要常數本身
  // 被改成 '*' 一樣會把全部欄位吐出去，前一條斷言看不出來。
  it('PAYMENT_METHOD_COLUMNS 常數本身沒有星號', () => {
    const code = withoutComments(src(SERVER_SHARED));
    const match = code.match(/PAYMENT_METHOD_COLUMNS\s*=\s*'([^']*)'/);
    expect(match, '找不到 PAYMENT_METHOD_COLUMNS 常數定義').not.toBeNull();
    expect(match![1]).not.toContain('*');
    // 對照組：常數確實包含實際欄位名稱，不是空字串。
    expect(match![1]).toContain('display_name');
  });
});

describe('線上刷卡誠實化：頁面不得再有金流憑證輸入欄位，必須引用 t.onlineNotReady（issue #9）', () => {
  const code = withoutComments(src(PAGE));

  // 拿掉這條：有人把「藍新／綠界商店帳號」的輸入框抄回表單，但目前沒有任何
  // 後端會儲存這些值——填了、按儲存、重整就消失，比誠實顯示「尚未開通」更糟。
  it.each(['gatewayMerchantId', 'gatewayHashKey', 'gatewayHashIv'])(
    '頁面不得再出現金流憑證輸入欄位 id="%s"',
    (fieldId) => {
      expect(code).not.toMatch(new RegExp(`["']${fieldId}["']`));
    },
  );

  // 對照組：上面三條「不得出現」不是因為整個 ONLINE_PAYMENT 分支被砍掉了，
  // 而是換成了誠實標示。
  it('線上刷卡分支確實引用 t.onlineNotReady', () => {
    expect(code).toMatch(/t\.onlineNotReady\.(title|description|badge|formNotice)/);
  });

  // 拿掉這條：有人把誠實 Alert 的文案改回宣稱已驗證，而不需要改動任何邏輯
  // 就能讓假成功復活。
  it('showGateway 段落沒有任何「已驗證／驗證開通」字樣', () => {
    const start = code.indexOf('showGateway ? (');
    expect(start, '頁面找不到 showGateway 分支').toBeGreaterThan(-1);
    const end = code.indexOf(') : null}', start);
    const block = code.slice(start, end === -1 ? undefined : end);
    expect(block).not.toMatch(/已驗證/);
    expect(block).not.toMatch(/驗證開通/);
  });

  /**
   * ⚠️ 上面那條只掃 `showGateway` 那一段，**掃不到列表卡片**。
   *
   * 2026-09-09 的最終風險評估把卡片上的 `<Badge>{t.onlineNotReady.badge}</Badge>`
   * 改成 `{t.badges.verified}`（字典裡那句是「已驗證開通」），整份測試 26/26 全綠。
   * 也就是說：一個字典鍵加一行改動，假的「金流已驗證」就能在畫面上復活，而
   * 這個宣稱「假成功的殘骸不得復活」的測試檔看不到。
   *
   * 所以改成掃**整個頁面**：那三個字典鍵一次都不許出現。它們仍留在
   * `src/i18n/zh-TW/pages/payment-methods.ts` 裡（記錄原站有過什麼），但頁面碰不得。
   */
  it.each(['t.badges.verified', 't.actions.testCharge', 't.testCharge.'])(
    '整頁任何位置都不得引用 %s（不只是 showGateway 段落）',
    (key) => {
      // 對照組：字典裡確實有這個鍵，所以「找不到」不是因為它根本不存在。
      const dict = src('src/i18n/zh-TW/pages/payment-methods.ts');
      const bare = key.replace(/^t\./, '').replace(/\.$/, '');
      const leaf = bare.split('.').pop()!;
      expect(dict, `字典裡沒有 ${key}，這條測試等於什麼都沒驗`).toMatch(
        new RegExp(`\\b${leaf}\\b`),
      );
      expect(code, `頁面又引用了 ${key}`).not.toContain(key);
    },
  );

  /**
   * QR 圖欄位曾經是一個 `type="file"` 的選檔器，但它沒有接任何上傳：
   * `onChange` 只把 `file.name` 存進 `qrImageUrl`，資料庫裡是「line-pay.png」
   * 這種字串，店家卻以為圖片上傳好了（最終風險評估 MINOR-1）。
   */
  it('QR 欄位不得是假的檔案上傳（沒有接 /api/upload 就不准放 type="file"）', () => {
    const hasFileInput = /type=\{?["']file["']/.test(code);
    const hasRealUpload = code.includes('uploadImage(');
    expect(
      hasFileInput && !hasRealUpload,
      '頁面有 type="file" 卻沒有呼叫 uploadImage()——那是只存檔名的假上傳',
    ).toBe(false);
  });
});

/**
 * ⚠️ 這一組補的是最終風險評估實測出來的兩個護欄缺口。兩者都不是當下的錯誤，
 * 而是「改壞了也不會有測試轉紅」。
 */
describe('護欄：改壞了要有東西轉紅（issue #9，2026-09-09 風險評估 MAJOR-1／MINOR-4）', () => {
  /**
   * MAJOR-1：`toApiPayload` 第一版把 `sortOrder` `Omit` 掉，於是表單上的排序欄位
   * 填了也送不出去——按儲存跳「已更新」，重新整理跳回舊值。這是這一頁原本那種
   * 假成功縮小到一個欄位的版本，而當時沒有任何測試會紅。
   *
   * 這裡驗**行為**而不是驗字面量：直接呼叫 `toApiPayload()` 看送出去的 body。
   */
  it('toApiPayload 真的把 sortOrder 放進送出的 body', async () => {
    const { toApiPayload } = await import('../../src/services/payment-methods');
    const body = toApiPayload({
      methodType: 'BANK_TRANSFER',
      displayName: '  國泰世華  ',
      qrImageUrl: '',
      bankName: '國泰世華', bankCode: '013', accountNumber: '123', accountHolderName: '王小明',
      instructions: '', active: true, sortOrder: 7,
    });
    expect(body.sortOrder, 'sortOrder 沒有被送出去——表單改了也不會存進資料庫').toBe(7);
    // 對照組：其他欄位本來就會送，證明這個 helper 真的在做事。
    expect(body.displayName).toBe('國泰世華');
    expect(body.config.bankCode).toBe('013');
  });

  /**
   * MINOR-4：把 `PUT`／`DELETE` 的 `.eq('tenant_id', …)` 拿掉之後，跨租戶整合測試
   * **仍然全綠**——因為 RLS 擋住了。RLS 是真防線沒錯，但端點註解寫的是
   * 「不靠 RLS 單獨成立」，而那句話當時沒有任何護欄。若日後有人照
   * `requireTenantManager()` 的模式把 client 換成 service role，RLS 就整個消失，
   * 那時只剩這一行擋著，而沒有測試會提醒你它還在不在。
   */
  it.each([
    ['route.ts（集合端點）', ROUTE_COLLECTION],
    ['[id]/route.ts（單筆端點）', ROUTE_ITEM],
  ])('%s：每一次碰 tenant_payment_methods 都綁住 tenant', (_label, path) => {
    const code = withoutComments(src(path));
    const count = (re: RegExp) => (code.match(re) ?? []).length;

    /*
     * 不寫死次數（那會在多一支查詢時假紅）。驗的是不變量：
     * 每一次 `.from('tenant_payment_methods')` 都必須被「一個 tenant_id 過濾條件」
     * 或「insert 時寫入 tenant_id」其中之一綁住。
     * 集合端點目前是 4 次 from：GET 清單、POST 的 count、POST 讀 max sort_order
     * 三次用 `.eq()`，第四次是 insert，改用 payload 裡的 `tenant_id: t.tenantId`。
     */
    const from = count(/\.from\(\s*['"]tenant_payment_methods['"]\s*\)/g);
    const filtered = count(/\.eq\(\s*['"]tenant_id['"]/g);
    const inserted = count(/tenant_id:\s*t\.tenantId/g);

    // 對照組：這支檔案必須真的在查這張表，否則下面的不等式恆真。
    expect(from, `${_label} 沒有查 tenant_payment_methods？`).toBeGreaterThan(0);
    expect(
      filtered + inserted,
      `${_label} 有 ${from} 次查詢，但只有 ${filtered + inserted} 次綁住 tenant——` +
        '應用層防線不能只剩 RLS',
    ).toBeGreaterThanOrEqual(from);
  });
});

describe('端點沒有任何 gateway 欄位（第三步才會有；現在出現＝有人建了沒人寫入的祕密欄位，issue #9）', () => {
  const GATEWAY_FIELDS = ['gateway_hash_key_enc', 'gateway_hash_iv_enc', 'gateway_merchant_id'];

  it.each([
    ['src/server/payment-methods.ts', SERVER_SHARED],
    ['route.ts（集合端點）', ROUTE_COLLECTION],
    ['[id]/route.ts（單筆端點）', ROUTE_ITEM],
  ])('%s 不得出現任何 gateway_* 欄位', (_label, path) => {
    const code = withoutComments(src(path));
    for (const field of GATEWAY_FIELDS) {
      expect(code, `${path} 出現了 ${field}`).not.toMatch(new RegExp(field));
    }
    // 對照組：這三個檔案確實都還在處理收款方式（否則「沒有出現 gateway 欄位」
    // 也可能只是因為檔案本身是空的、或已經改名不再相關）。
    expect(code).toMatch(/payment_method|PaymentMethod/);
  });
});
