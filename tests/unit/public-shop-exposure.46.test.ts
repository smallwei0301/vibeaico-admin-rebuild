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
import { execSync } from 'node:child_process';
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

  it('generateMetadata 自己有 try/catch，metadata 失敗不會把內部訊息送進 HTML', () => {
    /**
     * ⚠️ 這一條先把 `generateMetadata` 的**函式本體**切出來再檢查。
     *
     * 原本寫成 `page.match(/generateMetadata[\s\S]*?try/)`，那只要求「檔案後面某處
     * 有 try」——第二輪風險評估用一個變異證明了它的無效：把 generateMetadata 的
     * try/catch 拿掉、改在**頁面元件**裡放一個 try/catch，那條仍然是綠的，而洩漏
     * 照樣發生（洩漏的是 metadata 那一路，不是頁面那一路）。
     */
    const start = page.indexOf('export async function generateMetadata');
    expect(start, '找不到 generateMetadata').toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf('\n}', start));
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/catch\s*\(error\)/);
    expect(body).toContain('t.notFound.title');
  });

  it('同一次請求只查一次 DB，且不合格式的店家代碼在任何查詢之前就被擋掉', () => {
    /**
     * `generateMetadata` 與頁面各呼叫一次 loader，而 Next 的 request memoization
     * 只對 `fetch()` 生效，supabase-js 不在內——所以沒有 `cache()` 的話一個 200
     * 請求是最多 **10 次** service-role 查詢。這一頁是全站第一個匿名就打得到
     * 資料庫的路徑，而專案目前沒有任何 rate limit，這個倍數是實質的。
     */
    expect(loader).toMatch(/from 'react'/);
    expect(loader).toMatch(/export const loadPublicShop = cache\(/);

    /**
     * 形狀閘門與註冊 API 共用 `@/lib/shop-code`（見那個檔的檔頭：三層規則曾經
     * 不一致，會造出「後台顯示的網址永遠 404」的店家）。
     *
     * ⚠️ 位置也要鎖。第二輪風險評估的變異證明「只驗那行存在」不夠：把閘門移到
     * tenants 查詢**之後**，原本那條仍然是綠的，但它要防的事（不合格式的網址不該
     * 換到一次查詢）已經失效了。
     */
    expect(loader).toMatch(/from '@\/lib\/shop-code'/);
    const guard = loader.indexOf('if (!SHOP_CODE_PATTERN.test(shopCode)) return null;');
    const firstDbCall = loader.indexOf('createAdminSupabase()');
    expect(guard, '找不到店家代碼格式閘門').toBeGreaterThan(-1);
    expect(firstDbCall).toBeGreaterThan(-1);
    expect(guard, '格式閘門排在建立 DB client 之後，等於沒擋').toBeLessThan(firstDbCall);
  });
});

describe('店家代碼的規則只有一份', () => {
  /**
   * ⚠️ 這一條鎖的是一個**已經發生過兩次**的漂移。
   *
   * 這個規則原本散在四個地方（DB check、註冊 API、設定 API、註冊頁前端），彼此
   * 不一致。第一次收斂時我只收了註冊 API，還在檔頭寫「三個地方共用同一個來源」
   * ——設定 API 這個第二個寫入者被漏掉，那句話當時就不成立（PB-027）。
   *
   * 後果很具體：店家在設定頁把代碼改成超長字串會存進去，而**同一頁**就在顯示
   * `/s/{shopCode}` 當作「你的公開預約網址」，那個網址永遠 404 —— 正是 #299
   * 要修掉的缺陷本身。
   *
   * 所以這裡不鎖「某幾個檔有沒有 import」（那還是一份我當下想得到的清單），
   * 而是鎖「**這個 regex 的字面量只准出現在一個地方**」。日後任何人再抄一份，
   * 不論抄到哪個檔，這一條都會紅。
   */
  it('`/^[a-z0-9-]+$/` 這個字面量只出現在 src/lib/shop-code.ts 以外的 0 個地方', () => {
    const files = execSync(
      "grep -rln --include=*.ts --include=*.tsx '\\^\\[a-z0-9-\\]' src || true",
      { cwd: ROOT, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);

    // 對照組：至少要抓得到那個唯一的來源，否則 grep 本身壞了而這條恆真。
    expect(files, 'grep 連唯一的來源都沒抓到，這條測試本身失效了')
      .toContain('src/lib/shop-code.ts');

    const strays = files.filter((f) => f !== 'src/lib/shop-code.ts');
    expect(strays, `這些檔案自己抄了一份店家代碼規則：${strays.join(', ')}`).toEqual([]);
  });
});
