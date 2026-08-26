/**
 * 頁面層實測：選單設計頁「上傳圖片」按鈕 → /api/upload → tenant_settings（issue #7 (乙)）。
 *
 * 為什麼需要這一支：CLAUDE.md 記著的結構性盲點——單元測試不涵蓋頁面、整合測試刻意
 * 不測 UI，於是「按鈕有沒有真的接上」不屬於任何一層。這支用真實瀏覽器按那顆按鈕，
 * **判準不是 toast**，而是：
 *   ① service role 直查 `storage.objects` → 檔案真的在 richmenu-assets 裡；
 *   ② 直查 `tenant_settings.line->>'richMenuBgImageUrl'` → 網址真的落地
 *      （這是發布端點 loadBackgroundImage() 唯一會讀的地方，少了它上傳就白傳）；
 *   ③ **重新整理後欄位還在** → 不是只活在 React state 裡。
 *
 * ⚠️ 這支跑的是**本機 dev server**，不是 Preview 站：本 issue 的改動還沒 push，
 * Preview 上沒有這顆接好線的按鈕。用法：
 *
 *   # 另一個終端先起 dev server（TEST 專案的變數；不要和整合測試同時跑）
 *   NEXT_PUBLIC_USE_MOCK=false \
 *   NEXT_PUBLIC_SUPABASE_URL=$TEST_SUPABASE_URL \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=$TEST_SUPABASE_ANON_KEY \
 *   SUPABASE_SERVICE_ROLE_KEY=$TEST_SUPABASE_SERVICE_ROLE_KEY \
 *   ./node_modules/.bin/next dev -p 3210
 *
 *   PREVIEW_URL=http://localhost:3210 \
 *   TEST_EMAIL=owner-a@test.local TEST_PASSWORD='Passw0rd!a' \
 *   SUPABASE_REF=$SUPABASE_TEST_REF \
 *   node scripts/verify/rich-menu-bg-upload.07.cjs
 *
 * ⚠️ 跑完請 `rm -rf .next`（15 分冊：兩個 dev server 共用同一份 .next 開發快取會把
 * vendor chunk 寫壞，症狀是整批整合測試冒出 Cannot find module './vendor-chunks/…'）。
 *
 * 截圖一律寫進 scripts/verify/out/（已被 .gitignore 涵蓋）。
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  BASE, OUT_DIR, required, check, summary, shot, gotoStable, launch, login, readToast, sql,
} = require('./_preview-lib.cjs');

/** 本腳本預設跑 TEST 專案（dev server 接的是它）；打 Preview 站時改帶正式專案的 ref */
const REF = process.env.SUPABASE_REF || process.env.SUPABASE_TEST_REF;
/*
 * 直查鎖定的租戶。預設是 TEST 專案的種子租戶 A；打**已部署的 Preview 站**時它接的是
 * 正式專案，登入帳號的租戶 id 不一樣，用 VERIFY_TENANT_ID 覆寫。
 * （原本寫死，導致腳本無法指向 Preview——是腳本的缺陷，斷言一字未動。）
 */
const TENANT_A = process.env.VERIFY_TENANT_ID || 'a1000000-0000-4000-8000-000000000001';
/** 設 VERIFY_NO_CLEANUP=1 可保留現場除錯；預設一律清乾淨 */
const CLEANUP = process.env.VERIFY_NO_CLEANUP !== '1';

/** 2×2 PNG，四個像素顏色各異（與整合測試同一張，方便交叉比對） */
const BG_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GB4T8TAwMDAwAqHwMBnkE1zwAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  if (!REF) {
    console.error('[缺少環境變數] SUPABASE_REF（或 SUPABASE_TEST_REF）—— 要直查哪個 Supabase 專案。');
    process.exit(2);
  }
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');

  /** 收尾要還原的東西（打正式專案時是店家真實資料，不能留下痕跡） */
  let restoreBg = null;
  let uploadedObject = null;

  const fixture = path.join(OUT_DIR, 'rich-menu-bg-fixture.png');
  fs.writeFileSync(fixture, BG_PNG);

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    console.log(`\n=== 選單設計頁：背景圖上傳接線（${BASE}）===\n`);
    await login(page, email, password);

    // ---- 起點：先把設定清空，才知道之後看到的值是這次上傳造成的 ----
    // 打 Preview 站時動到的是**正式專案裡店家真實的設定**，所以先記下原值，
    // 收尾一定要放回去（見本檔結尾的 finally）。
    const [{ bg: originalBg = null } = {}] = await sql(
      `select line->>'richMenuBgImageUrl' as bg from tenant_settings
       where tenant_id = '${TENANT_A}';`,
      REF,
    );
    restoreBg = originalBg;
    console.log(`  起點：原本的 richMenuBgImageUrl = ${originalBg === null ? '(無此鍵)' : originalBg || '(空字串)'}`);
    await sql(
      `update tenant_settings set line = jsonb_set(coalesce(line,'{}'::jsonb),
         '{richMenuBgImageUrl}', '""'::jsonb) where tenant_id = '${TENANT_A}';`,
      REF,
    );
    const beforeObjects = await sql(
      `select count(*)::int as n from storage.objects
       where bucket_id='richmenu-assets' and name like '${TENANT_A}/%';`,
      REF,
    );
    console.log(`  起點：bucket 內既有物件 ${beforeObjects[0].n} 筆，richMenuBgImageUrl 已清空`);

    await gotoStable(page, `${BASE}/tenant/rich-menu-design`);
    await shot(page, 'richmenu-bg-01-before');

    // ---- 按下「上傳圖片」：那顆按鈕會 click() 一個隱藏的 file input ----
    const fileInput = page.locator('input[type="file"][accept="image/jpeg,image/png"]');
    check('隱藏的檔案輸入存在（＝按鈕不是死的）', (await fileInput.count()) > 0);
    await fileInput.first().setInputFiles(fixture);

    const toast = await readToast(page).catch(() => '(沒有 toast)');
    console.log(`  toast：${toast}`);
    await shot(page, 'richmenu-bg-02-uploaded');

    // ---- 判準①：service role 直查 storage.objects ----
    const objects = await sql(
      `select name, metadata->>'mimetype' as mimetype, metadata->>'size' as size
       from storage.objects
       where bucket_id='richmenu-assets' and name like '${TENANT_A}/%'
       order by created_at desc limit 1;`,
      REF,
    );
    const afterCount = await sql(
      `select count(*)::int as n from storage.objects
       where bucket_id='richmenu-assets' and name like '${TENANT_A}/%';`,
      REF,
    );
    check(
      'storage.objects 真的多了一個物件（不是只有 toast）',
      afterCount[0].n === beforeObjects[0].n + 1,
      `${beforeObjects[0].n} → ${afterCount[0].n}；最新一筆 ${JSON.stringify(objects[0])}`,
    );
    check(
      '該物件的大小與我們上傳的圖一致',
      objects[0] && Number(objects[0].size) === BG_PNG.byteLength,
      `size=${objects[0] && objects[0].size} / 期望 ${BG_PNG.byteLength}`,
    );

    // ---- 判準②：網址寫進 tenant_settings（發布端點唯一會讀的地方）----
    const settings = await sql(
      `select line->>'richMenuBgImageUrl' as bg from tenant_settings
       where tenant_id = '${TENANT_A}';`,
      REF,
    );
    const savedUrl = settings[0].bg || '';
    uploadedObject = objects[0] && objects[0].name;
    check(
      'tenant_settings.line.richMenuBgImageUrl 真的被寫入（發布才用得到）',
      savedUrl.includes(objects[0].name),
      savedUrl || '(空)',
    );

    // ---- 判準③：重新整理後欄位還在（不是只活在 React state）----
    // ⚠️ 不能用 `input[value="…"]` 選：React controlled input 設的是 DOM **property**，
    // `value` 屬性不會跟著變，那個選擇器對受控欄位永遠選不到（第一版就這樣誤報了一次紅燈）。
    // 一律用 inputValue() 讀當下的值。
    await gotoStable(page, `${BASE}/tenant/rich-menu-design`);
    const urlInput = page.getByPlaceholder('貼上圖片 URL 或上傳圖片...');
    const shown = await urlInput.first().inputValue().catch(() => '(讀不到欄位)');
    check('重新整理後網址欄位仍顯示剛上傳的圖（讀得回來）', shown === savedUrl, `畫面上=${shown}`);
    await shot(page, 'richmenu-bg-03-after-reload');
  } catch (e) {
    check('腳本執行完成', false, e && e.message);
    await shot(page, 'richmenu-bg-99-error').catch(() => {});
  } finally {
    await browser.close();
    /*
     * 收尾：本腳本在正式專案上跑時，上面兩個副作用動到的是店家的真實資料
     * （多一個 storage 物件、richMenuBgImageUrl 被覆寫），一定要還原並驗證。
     * TEST 專案上跑則無害（reset-db 每次會清），還原一樣不會有副作用。
     */
    if (CLEANUP) {
      if (uploadedObject) {
        await sql(
          `delete from storage.objects where bucket_id='richmenu-assets'
           and name = '${uploadedObject.replace(/'/g, "''")}';`,
          REF,
        ).catch((e) => console.log(`  [清理失敗] 刪 storage 物件：${e.message}`));
      }
      await sql(
        restoreBg === null
          ? `update tenant_settings set line = coalesce(line,'{}'::jsonb) - 'richMenuBgImageUrl'
             where tenant_id = '${TENANT_A}';`
          : `update tenant_settings set line = jsonb_set(coalesce(line,'{}'::jsonb),
               '{richMenuBgImageUrl}', to_jsonb('${String(restoreBg).replace(/'/g, "''")}'::text))
             where tenant_id = '${TENANT_A}';`,
        REF,
      ).catch((e) => console.log(`  [清理失敗] 還原 richMenuBgImageUrl：${e.message}`));

      const [left] = await sql(
        `select count(*)::int as n from storage.objects
         where bucket_id='richmenu-assets' and name = '${String(uploadedObject || '').replace(/'/g, "''")}';`,
        REF,
      ).catch(() => [{ n: -1 }]);
      const [{ bg: nowBg = null } = {}] = await sql(
        `select line->>'richMenuBgImageUrl' as bg from tenant_settings
         where tenant_id = '${TENANT_A}';`,
        REF,
      ).catch(() => [{}]);
      console.log(`  清理驗證：本次上傳的物件殘留 ${left.n} 筆；`
        + `richMenuBgImageUrl 已還原為 ${nowBg === null ? '(無此鍵)' : nowBg || '(空字串)'}`);
    }
  }

  const { fail } = summary();
  process.exit(fail > 0 ? 1 : 0);
})();
