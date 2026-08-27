/**
 * scripts/verify/export-downloads.28.cjs
 * -----------------------------------------------------------------------------
 * issue #28 ③④⑤ 的頁面層實測：預約／顧客／庫存三頁的「匯出」鈕按下去，
 * **斷言瀏覽器真的收到 download 事件**、檔名非空、而且**畫面上那句成功訊息裡的
 * 檔名與實際存下來的檔名逐字相同**。
 *
 * 為什麼不以 toast 為證據：這三顆鈕原本就是「只跳一則成功訊息、什麼都沒下載」，
 * 其中兩顆還憑空報出一個具體檔名（顧客清單_20260825.xlsx）。看到成功訊息不代表
 * 下載發生了——所以這裡量的是 download 事件、檔案位元組、以及兩個檔名對不對得上。
 *
 * 另外驗 CSV 的頭三個位元組是 UTF-8 BOM（EF BB BF）。**必須讀位元組**：
 * 用字串比對 `text.startsWith('﻿')` 永遠是 false，UTF-8 解碼會把 BOM 吃掉，
 * 那條斷言量的是解碼器不是檔案（本專案踩過兩次）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   PREVIEW_URL=<站台> TEST_EMAIL=… TEST_PASSWORD=… node scripts/verify/export-downloads.28.cjs
 *
 * PREVIEW_URL 可以指向本機 `next dev`（分支尚未 push 時就得這樣做，
 * _preview-lib 會自動不帶出口 proxy）。本輪實跑用的是
 * `NEXT_PUBLIC_USE_MOCK=false npx next dev -p 3210`，接的是正式 Supabase 專案
 * ——與 Preview 站同一個資料庫。
 *
 * ⚠️ 本腳本**只讀不寫**：三頁都只按匯出，不新增、不修改任何一列資料。
 * 下載檔與截圖一律進 scripts/verify/out/（playbook「實測腳本的兩條慣例」）。
 */
const path = require('node:path');
const fs = require('node:fs');

const {
  BASE, OUT_DIR, required, check, summary, launch, login, gotoStable, readToast, waitToastGone,
  clickModalButton,
} = require('./_preview-lib.cjs');

const DOWNLOAD_DIR = path.join(OUT_DIR, 'downloads-28');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

/** 按下去 → 等 download 事件 → 存檔 → 回 { fileName, bytes, toast } */
async function expectDownload(page, label, clickFn) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    clickFn(),
  ]);
  const fileName = download.suggestedFilename();
  const saved = path.join(DOWNLOAD_DIR, `${label}-${fileName}`);
  await download.saveAs(saved);
  const bytes = fs.readFileSync(saved);
  const toast = await readToast(page).catch(() => '');
  console.log(`  ↓ ${label}：檔名 ${fileName}，${bytes.length} bytes，存到 ${saved}`);
  console.log(`    toast：${toast}`);
  return { fileName, bytes, toast, saved };
}

function assertCsv(label, r) {
  check(`${label}：download 事件觸發且檔名非空`, !!r.fileName && r.fileName !== 'download', r.fileName);
  check(`${label}：檔名是伺服器給的 <name>-YYYY-MM-DD.csv`, /^[a-z]+-\d{4}-\d{2}-\d{2}\.csv$/.test(r.fileName), r.fileName);
  check(
    `${label}：檔案開頭是 UTF-8 BOM 的位元組 EF BB BF`,
    r.bytes[0] === 0xef && r.bytes[1] === 0xbb && r.bytes[2] === 0xbf,
    [...r.bytes.slice(0, 3)].map((b) => b.toString(16)).join(' '),
  );
  check(
    `${label}：內容是檔案不是 { success, data } 信封`,
    !r.bytes.toString('utf-8').replace(/^﻿/, '').startsWith('{'),
    r.bytes.toString('utf-8').replace(/^﻿/, '').split('\r\n')[0],
  );
  check(
    `${label}：成功訊息裡的檔名＝實際存下來的檔名（不是前端自組的）`,
    r.toast.includes(r.fileName),
    `toast="${r.toast}" / file="${r.fileName}"`,
  );
}

async function main() {
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');

  console.log(`站台：${BASE}`);
  const browser = await launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  try {
    await login(page, email, password);
    console.log('已登入');

    /* ---------------------------------------------------------- ③ 預約 */
    await gotoStable(page, `${BASE}/tenant/bookings`);
    await page.getByRole('button', { name: '匯出', exact: true }).click();
    const bookings = await expectDownload(page, 'bookings', () =>
      page.getByRole('button', { name: '匯出 Excel 可開啟的 CSV', exact: true }).click());
    assertCsv('③ 預約匯出', bookings);
    check(
      '③ 預約匯出：CSV 表頭＝預約列表頁的欄位',
      bookings.bytes.toString('utf-8').includes('預約編號,預約時間,顧客姓名'),
      bookings.bytes.toString('utf-8').split('\r\n')[0],
    );
    await waitToastGone(page);

    /* ---------------------------------------------------------- ④ 顧客 */
    await gotoStable(page, `${BASE}/tenant/customers`);
    const customers = await expectDownload(page, 'customers', () =>
      page.getByRole('button', { name: '匯出 Excel 可開啟的 CSV', exact: true }).click());
    assertCsv('④ 顧客匯出', customers);
    check(
      '④ 顧客匯出：檔名不再是捏造的「顧客清單_日期.xlsx」',
      !customers.toast.includes('.xlsx') && !customers.toast.includes('顧客清單_'),
      customers.toast,
    );
    await waitToastGone(page);

    /* ---------------------------------------------------------- ⑤ 庫存 */
    await gotoStable(page, `${BASE}/tenant/inventory`);
    await page.getByRole('button', { name: '匯出', exact: true }).first().click();
    // 確認視窗裡選格式（兩個選項都產 CSV，見 /api/export/inventory/:format 檔頭）
    await page.locator('[role="dialog"]').last().locator('select').selectOption('csv');
    const inventory = await expectDownload(page, 'inventory', () =>
      clickModalButton(page, '匯出'));
    assertCsv('⑤ 庫存匯出', inventory);
    check(
      '⑤ 庫存匯出：CSV 表頭＝庫存異動頁的欄位',
      inventory.bytes.toString('utf-8').includes('時間,商品,異動類型,數量,異動前,異動後,原因,操作者'),
      inventory.bytes.toString('utf-8').split('\r\n')[0],
    );
  } finally {
    await browser.close();
  }

  const { fail } = summary();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
