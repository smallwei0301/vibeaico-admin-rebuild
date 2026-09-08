/**
 * tests/unit/public-shop-exposure.46.test.ts — 公開頁的外洩面鎖（issue #46）
 *
 * ⚠️ 這個檔讀的是**原始碼文字**，不是行為。它能證明「select 清單長什麼樣、有沒有
 * 加閘門」，**證不到**「匿名訪客真的讀不到別家店的資料」——後者要真 DB ＋ 真 HTTP，
 * 見 `tests/integration/api/public-shop.46.test.ts`。
 *
 * 那為什麼還要有這一層？因為 `src/server/public-shop.ts` 是**全站唯一一條不經過
 * `requireTenant()` 的資料路徑**，而它用的是 service role（繞過 RLS）。整個外洩
 * 判準落在那個檔自己的 select 清單上。這一層鎖的正是「那份清單有沒有被悄悄放寬」
 * ——那種改動在行為測試上往往不會紅（多回幾個欄位不會讓既有斷言失敗），但在這裡會。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const loader = withoutComments(readFileSync(resolve(ROOT, 'src/server/public-shop.ts'), 'utf8'));
const page = withoutComments(readFileSync(resolve(ROOT, 'src/app/s/[shopCode]/page.tsx'), 'utf8'));

/** loader 裡所有 `.select('…')` 的字串內容 */
const selects = [...loader.matchAll(/\.select\(\s*'([^']*)'/g)].map((m) => m[1]);

describe('公開頁的 select 清單', () => {
  it('至少有四個 select（tenants / trips / services / trip_plans / trip_departures）', () => {
    // 這一條先確認下面幾條真的有東西可以檢查——空集合會讓所有 every() 恆真。
    expect(selects.length).toBeGreaterThanOrEqual(4);
  });

  it('沒有任何 select(*)：加欄位必須有人主動決定它能不能公開', () => {
    /**
     * 用 `*` 的話，日後任何一支 migration 加的欄位都會自動被公開出去，而沒有人
     * 會發現。這一條擋的就是那個。
     */
    for (const s of selects) {
      expect(s.includes('*'), `select('${s}') 含有 *`).toBe(false);
    }
  });

  it('完全不碰顧客、員工、預約、訂單這四張表', () => {
    for (const table of ['customers', 'staff', 'bookings', 'product_orders', 'tour_orders']) {
      expect(loader.includes(`from('${table}')`), `公開頁讀了 ${table}`).toBe(false);
    }
  });

  it('不取任何加密祕密欄位', () => {
    for (const secret of [
      'line_channel_secret_enc',
      'line_channel_access_token_enc',
      'channelSecret',
      'channelAccessToken',
    ]) {
      expect(loader.includes(secret), `公開頁碰了 ${secret}`).toBe(false);
    }
  });

  it('tenant_settings 只取 basic 與 line 兩塊，不整包送出', () => {
    // notify / privacy / points / branding 裡有店家的內部設定，不該出現在公開頁。
    const tenantSelect = selects.find((s) => s.includes('tenant_settings'));
    expect(tenantSelect).toBeTruthy();
    expect(tenantSelect).toContain('tenant_settings(basic, line)');
    for (const block of ['notify', 'privacy', 'points', 'branding']) {
      expect(tenantSelect!.includes(block), `tenant_settings 帶出了 ${block}`).toBe(false);
    }
  });

  it('line 那一塊只有 lineBasicId 被讀出來', () => {
    // `tenant_settings(basic, line)` 會把整個 line jsonb 撈進伺服器記憶體（PostgREST
    // 無法只取 jsonb 的某個 key），所以真正的閘門是「送到頁面的物件裡只有哪些欄位」。
    const lineReads = [...loader.matchAll(/settings\?\.line\?\.(\w+)/g)].map((m) => m[1]);
    expect(lineReads).toEqual(['lineBasicId']);
  });
});

describe('公開頁的可見範圍閘門', () => {
  it('行程只回已發布的（status = PUBLISHED）', () => {
    expect(loader).toMatch(/\.eq\('status',\s*'PUBLISHED'\)/);
  });

  it('服務項目與方案只回未停用的（active = true）', () => {
    expect((loader.match(/\.eq\('active',\s*true\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('團次只回 OPEN 且今天以後的', () => {
    expect(loader).toMatch(/\.eq\('status',\s*'OPEN'\)/);
    expect(loader).toMatch(/\.gte\('departs_on',\s*today\)/);
  });

  it('每一次查詢都以 tenant_id 收窄（service role 繞過 RLS，這是唯一的租戶邊界）', () => {
    // tenants 那一次用 shop_code 定位，其餘四次都必須有 tenant_id。
    const tenantIdFilters = (loader.match(/\.eq\('tenant_id',\s*tenantId\)/g) ?? []).length;
    expect(tenantIdFilters).toBeGreaterThanOrEqual(4);
  });

  it('查詢失敗一律 throw，不讓它冒充「查無此店」（PB-023）', () => {
    // 丟掉 error 的話，一次 DB 故障會讓所有店家的公開頁一起變成 404，
    // 而顧客看到的訊息是「找不到這家店」——完全誤導。
    const throwsOnError = (loader.match(/if\s*\(\w*[Ee]rror\)\s*throw/g) ?? []).length;
    expect(throwsOnError).toBeGreaterThanOrEqual(4);
  });
});

describe('這一版不得出現可以下單的 UI', () => {
  it('頁面沒有 form、沒有 button、沒有任何 POST', () => {
    /**
     * 線上下單與付款（#12／#32）整條鏈都還沒建，`/pay/*` 不存在。放一顆按了沒反應
     * 的「立即預約」，顧客會以為自己訂好了——那正是本專案反覆記錄的假成功。
     *
     * 這一條鎖住「在付款鏈建好之前，這一頁不會偷偷長出下單入口」。等 #12／#32 完成
     * 要接上時，這條測試會紅——那時候是**刻意**要改它，並且要同時證明下單真的會成立。
     */
    expect(page).not.toMatch(/<form/);
    expect(page).not.toMatch(/<button/);
    expect(page).not.toMatch(/method:\s*'POST'/);
  });

  it('明確告訴顧客目前要怎麼預約，而不是留白', () => {
    expect(page).toContain('t.booking.howTo');
  });
});

/**
 * 以下三條鎖的是 2026-09-08 最終風險評估抓到的三個實質缺陷。每一條都寫明「拿掉會
 * 發生什麼」——否則下一個人會把它們讀成可有可無的整潔規則而順手刪掉。
 */
describe('公開頁的錯誤與負載面（風險評估後補上的鎖）', () => {
  it('錯誤一律包成訊息固定的 Error，不把 PostgREST 的物件原封丟出去', () => {
    /**
     * supabase-js 的 error 是 **plain object**（`{message, details, hint, code}`）。
     * Next 對 page render 的錯誤會壓成 digest，但 `generateMetadata` 拋出的錯誤
     * **不會**——它被逐字序列化進公開 HTML 的 RSC payload（實測可見
     * `"error":{"message":…,"hint":…}`）。PostgREST 的訊息可能含表名、欄位名、
     * SQL 片段與 `Key (…)=(…)`，對匿名訪客就是內部結構洩漏。
     */
    expect(loader).toContain('function queryFailed(');
    expect(loader).toMatch(/new Error\(`PUBLIC_SHOP_QUERY_FAILED:/);
    const rawThrows = loader.match(/throw\s+\w*[Ee]rror;/g) ?? [];
    expect(rawThrows, `還有 ${rawThrows.length} 處把原始 error 直接丟出去`).toEqual([]);
  });

  it('generateMetadata 有 try/catch，metadata 失敗不會把內部訊息送進 HTML', () => {
    expect(page).toMatch(/generateMetadata[\s\S]*?try\s*\{/);
    expect(page).toMatch(/catch\s*\(error\)[\s\S]*?t\.notFound\.title/);
  });

  it('同一次請求只查一次 DB，且不合格式的店家代碼不進資料庫', () => {
    /**
     * `generateMetadata` 與頁面各呼叫一次 loader，而 Next 的 request memoization
     * 只對 `fetch()` 生效，supabase-js 不在內——所以沒有 `cache()` 的話一個 200
     * 請求是最多 **10 次** service-role 查詢。這一頁是全站第一個匿名就打得到
     * 資料庫的路徑，而專案目前沒有任何 rate limit，這個倍數是實質的。
     *
     * `shop_code` 在 DB 上是 `check (shop_code ~ '^[a-z0-9-]+$')`，不合這個形狀的
     * 字串必然查無此店——先擋掉，別讓一個 2000 字元的亂碼網址換到一次查詢。
     */
    expect(loader).toMatch(/from 'react'/);
    expect(loader).toMatch(/export const loadPublicShop = cache\(/);
    expect(loader).toMatch(/SHOP_CODE_PATTERN\s*=\s*\/\^\[a-z0-9-\]/);
    expect(loader).toMatch(/if \(!SHOP_CODE_PATTERN\.test\(shopCode\)\) return null;/);
  });
});
