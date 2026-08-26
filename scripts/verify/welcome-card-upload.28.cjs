/**
 * scripts/verify/welcome-card-upload.28.cjs
 * -----------------------------------------------------------------------------
 * issue #28 ⑥ 的頁面層實測：店家設定 → 通知設定 →「歡迎卡片圖片（自訂）」的
 * 「上傳圖片」鈕。這顆鈕原本的 onClick **整個內容**就是一句
 * `toast.show('歡迎卡片圖片已更新')`：不開檔案選擇器、不上傳、不改任何 state。
 *
 * 判準刻意不是 toast，而是三件外部可查證的事：
 *   ① 檔案真的在 bucket 裡 —— 以 service role **直查 `storage.objects`**
 *      （不是只看端點回 200，也不是看畫面）
 *   ② 網址真的存回 `tenant_settings.notify.welcomeCardImageUrl` —— 直查該欄位
 *   ③ **重整之後圖片還在** —— 重新載入頁面，欄位裡仍是同一個網址
 *      （只留在 React state 的話，這一條就會紅）
 * 另外驗那個公開網址真的取得回圖片位元組（PNG 檔頭 89 50 4E 47）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   PREVIEW_URL=<站台> TEST_EMAIL=… TEST_PASSWORD=… SUPABASE_ACCESS_TOKEN=sbp_…
 *   node scripts/verify/welcome-card-upload.28.cjs
 *
 * PREVIEW_URL 可指向本機 `next dev`（分支尚未 push 時就得這樣做）。本輪實跑用的是
 * `NEXT_PUBLIC_USE_MOCK=false npx next dev -p 3210`，接的是**正式 Supabase 專案**
 * ——與 Preview 站同一個資料庫，所以下面的直查與 Preview 站看到的是同一份資料。
 *
 * ⚠️ 本腳本會寫入資料（這是它的重點）。收尾一律還原：
 *   - 用畫面上的「移除圖片」鈕把設定清回去（順便實測那顆鈕也真的存回資料庫）
 *   - 以 service role key 打 Storage API 刪掉這次上傳的物件
 *     （⚠️ 不能用 SQL `delete from storage.objects`：Supabase 裝了
 *     `storage.protect_delete()` trigger，直接刪表會回 42501「Direct deletion
 *     from storage tables is not allowed」——實跑撞過，改走 Storage API）
 *   - 最後把 `welcomeCardImageUrl` 直接寫回腳本開始前的原值
 */
const path = require('node:path');
const fs = require('node:fs');

const {
  BASE, OUT_DIR, required, check, summary, launch, login, gotoStable, readToast, waitToastGone, sql,
} = require('./_preview-lib.cjs');

/** 1×1 PNG（與整合測試用的同一份 base64） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const BUCKET = 'welcome-card-images';

/** SQL 字串常值跳脫（單引號雙寫）——只用在本腳本自己組出來的路徑／網址上 */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');
  required('SUPABASE_ACCESS_TOKEN');

  const pngPath = path.join(OUT_DIR, 'welcome-card-28.png');
  fs.writeFileSync(pngPath, PNG_1X1);

  console.log(`站台：${BASE}`);

  const before = await sql(
    "select tenant_id, notify->>'welcomeCardImageUrl' as url from tenant_settings",
  );
  console.log(`上傳前 tenant_settings：${JSON.stringify(before)}`);
  const tenantId = before[0].tenant_id;
  const originalUrl = before[0].url ?? '';

  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await ctx.newPage();
  let uploadedUrl = '';

  try {
    await login(page, email, password);
    await gotoStable(page, `${BASE}/tenant/settings#notification`);

    /* 隱藏的 <input type="file">：setInputFiles 直接餵檔，等同使用者在選檔視窗挑檔 */
    const fileInput = page.locator('input[type="file"][accept="image/jpeg,image/png"]');
    await fileInput.setInputFiles(pngPath);

    const toast = await readToast(page, 45_000);
    console.log(`  toast：${toast}`);
    check('⑥ 上傳後顯示的是「已更新」而不是失敗', toast.includes('歡迎卡片圖片已更新'), toast);

    uploadedUrl = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const found = inputs.find((i) => i.value.includes('/welcome-card-images/'));
      return found ? found.value : '';
    });
    console.log(`  畫面上的網址：${uploadedUrl}`);
    check('⑥ 畫面欄位換成了剛上傳的公開網址', uploadedUrl.includes(`/${BUCKET}/${tenantId}/`), uploadedUrl);

    /* ── ① service role 直查 storage.objects ─────────────────────────── */
    const objectPath = uploadedUrl.split(`/${BUCKET}/`)[1] ?? '';
    const objects = await sql(
      `select o.name, o.bucket_id, o.metadata->>'size' as size, o.metadata->>'mimetype' as mimetype
         from storage.objects o
        where o.bucket_id = ${q(BUCKET)} and o.name = ${q(objectPath)}`,
    );
    console.log(`  storage.objects 直查：${JSON.stringify(objects)}`);
    check('⑥ 檔案真的在 bucket 裡（storage.objects 查得到那一列）', objects.length === 1, JSON.stringify(objects));
    check(
      '⑥ 物件路徑第一段＝租戶 id（0008/0023 的 storage RLS 規則）',
      objects.length === 1 && objects[0].name.startsWith(`${tenantId}/`),
      objects[0] && objects[0].name,
    );

    /* 公開網址真的取得回圖片位元組（不是只有一列 metadata） */
    const fetched = await fetch(uploadedUrl);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    check(
      '⑥ 公開網址取得回 PNG 位元組（89 50 4E 47）',
      fetched.status === 200 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
      `status=${fetched.status} bytes=${bytes.length} head=${[...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`,
    );

    /* ── ② 網址真的存回 tenant_settings ──────────────────────────────── */
    const afterUpload = await sql(
      "select notify->>'welcomeCardImageUrl' as url from tenant_settings",
    );
    console.log(`  上傳後 tenant_settings：${JSON.stringify(afterUpload)}`);
    check(
      '⑥ 網址存回 tenant_settings.notify.welcomeCardImageUrl（不是只在 React state）',
      afterUpload[0].url === uploadedUrl,
      `db="${afterUpload[0].url}"`,
    );

    /* ── ③ 重整之後圖片還在 ─────────────────────────────────────────── */
    await waitToastGone(page);
    await gotoStable(page, `${BASE}/tenant/settings#notification`);
    const afterReload = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const found = inputs.find((i) => i.value.includes('/welcome-card-images/'));
      return found ? found.value : '';
    });
    console.log(`  重整後畫面上的網址：${afterReload}`);
    check('⑥ 重整後圖片仍在（欄位裡是同一個網址）', afterReload === uploadedUrl, afterReload);

    await page.screenshot({ path: path.join(OUT_DIR, 'welcome-card-28-after-reload.png'), fullPage: true });

    /* ── 收尾：用畫面上的「移除圖片」鈕還原，順便實測它也真的存回資料庫 ── */
    await page.getByRole('button', { name: '移除圖片', exact: true }).click();
    const removeToast = await readToast(page, 45_000);
    console.log(`  移除 toast：${removeToast}`);
    const afterRemove = await sql("select notify->>'welcomeCardImageUrl' as url from tenant_settings");
    console.log(`  移除後 tenant_settings：${JSON.stringify(afterRemove)}`);
    check('⑥ 移除鈕也真的存回資料庫（欄位被清空）', afterRemove[0].url === '', JSON.stringify(afterRemove));
  } finally {
    await browser.close();

    /* Storage 物件與原值一律還原（本腳本是這一輪唯一會寫資料的一支） */
    if (uploadedUrl) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) {
        console.error('  [未清理] 缺 SUPABASE_SERVICE_ROLE_KEY，測試用 Storage 物件留在 bucket 裡：', uploadedUrl);
      } else {
        const del = await fetch(uploadedUrl.replace('/object/public/', '/object/'), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${serviceKey}` },
        });
        console.log(`  刪除測試用 Storage 物件：HTTP ${del.status} ${(await del.text()).slice(0, 120)}`);
      }
    }
    await sql(
      `update tenant_settings
          set notify = jsonb_set(notify, '{welcomeCardImageUrl}', to_jsonb(${q(originalUrl)}::text))
        where tenant_id = ${q(tenantId)}`,
    ).catch((e) => console.error('  還原 welcomeCardImageUrl 失敗：', e.message));
    console.log(`  已把 welcomeCardImageUrl 還原為腳本開始前的原值（"${originalUrl}"）`);
  }

  const { fail } = summary();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
