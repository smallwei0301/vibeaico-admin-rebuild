/**
 * 頁面層實測：行銷推播 / 行銷活動兩頁的接線（issue #7 (乙)）。
 *
 * 為什麼需要這一支：這兩頁在本 issue 之前的每一個動作都是
 * `await new Promise((r) => setTimeout(r, 380))` 加一句成功 toast——端點都在、
 * 整合測試也綠，就是沒有人呼叫過。整合測試刻意不測 UI、單元測試不涵蓋頁面，
 * 所以「頁面有沒有真的呼叫 service」不屬於任何一層（CLAUDE.md 記著的結構性盲點）。
 *
 * **判準一律不是 toast**，而是 service role 直查資料庫：
 *   - 建立活動 → `campaigns` 真的多一列，status='DRAFT'
 *   - 發布     → 那一列的 status 真的變成 'PUBLISHED'
 *   - 刪除     → 那一列真的不見了
 *   - 建立推播 → `marketing_pushes` 真的多一列
 * 另外驗一件「不准捏造已知」的事：真實模式下沒有的數字（預估人數／參與人數）
 * 畫面必須顯示 `--`，不是 0。
 *
 * 用法與 rich-menu-bg-upload.07.cjs 相同（本機 dev server + TEST 專案）：
 *
 *   PREVIEW_URL=http://localhost:3210 \
 *   TEST_EMAIL=owner-a@test.local TEST_PASSWORD='Passw0rd!a' \
 *   SUPABASE_REF=$SUPABASE_TEST_REF \
 *   node scripts/verify/marketing-campaigns-wiring.07.cjs
 *
 * ⚠️ 跑完請 `rm -rf .next`（15 分冊）。截圖寫進 scripts/verify/out/。
 */
const {
  BASE, required, check, summary, shot, gotoStable, launch, login,
  readToast, waitToastGone, clickModalButton, sql,
} = require('./_preview-lib.cjs');

const REF = process.env.SUPABASE_REF || process.env.SUPABASE_TEST_REF;
const TENANT_A = 'a1000000-0000-4000-8000-000000000001';

/** 本腳本造出的資料一律帶這個前綴，收尾只刪自己的 */
const TAG = '#7乙實測';
const CAMPAIGN_NAME = `${TAG} 活動`;
const PUSH_TITLE = `${TAG} 推播`;

const q = (s) => s.replace(/'/g, "''");

(async () => {
  if (!REF) {
    console.error('[缺少環境變數] SUPABASE_REF（或 SUPABASE_TEST_REF）');
    process.exit(2);
  }
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    console.log(`\n=== 行銷推播 / 行銷活動：頁面接線實測（${BASE}）===\n`);
    await login(page, email, password);

    // 起點乾淨：先刪掉可能殘留的同名資料
    await sql(`delete from campaigns where tenant_id='${TENANT_A}' and name like '${q(TAG)}%';`, REF);
    await sql(`delete from marketing_pushes where tenant_id='${TENANT_A}' and title like '${q(TAG)}%';`, REF);

    /* ------------------------------------------------ 行銷活動 */
    await gotoStable(page, `${BASE}/tenant/campaigns`);
    await shot(page, 'campaigns-01-list');

    // 「參與人數」在真實模式是未知 → 必須是 --，不是 0（CLAUDE.md：不准捏造已知）
    const bodyText = await page.locator('body').innerText();
    check(
      '參與人數欄位沒有出現捏造的 0（未知就顯示 --）',
      !/參與人數[\s\S]{0,40}?\b0 人/.test(bodyText),
      '（真實模式沒有任何一張表記得誰參加了哪個活動）',
    );

    // 清單空的時候 EmptyState 也會給一顆同名按鈕（頁首一顆＋空狀態一顆）→ 取 first()
    await page.getByRole('button', { name: '新增活動', exact: true }).first().click();
    await page.locator('#campaignName').fill(CAMPAIGN_NAME);
    await page.locator('#campaignPushMessage').fill(`${TAG} 的推播文案`);
    await clickModalButton(page, '儲存');
    console.log(`  toast：${await readToast(page).catch(() => '(沒有 toast)')}`);
    await waitToastGone(page);

    let rows = await sql(
      `select id, status from campaigns where tenant_id='${TENANT_A}' and name='${q(CAMPAIGN_NAME)}';`,
      REF,
    );
    check('建立活動 → campaigns 真的多一列（不是只有 toast）', rows.length === 1, JSON.stringify(rows));
    check('新建活動一律是 DRAFT（存檔 ≠ 發布）', rows[0] && rows[0].status === 'DRAFT',
      rows[0] && rows[0].status);
    const campaignId = rows[0] && rows[0].id;
    await shot(page, 'campaigns-02-created');

    // 發布
    await page.getByRole('row', { name: new RegExp(TAG) })
      .getByRole('button', { name: '發布', exact: true }).click();
    await clickModalButton(page, '發布');
    console.log(`  toast：${await readToast(page).catch(() => '(沒有 toast)')}`);
    await waitToastGone(page);

    rows = await sql(`select status from campaigns where id='${campaignId}';`, REF);
    check('發布 → DB 的 status 真的變成 PUBLISHED（顧客那端才看得到）',
      rows[0] && rows[0].status === 'PUBLISHED', rows[0] && rows[0].status);
    await shot(page, 'campaigns-03-published');

    // 刪除
    await page.getByRole('row', { name: new RegExp(TAG) })
      .getByRole('button', { name: '刪除', exact: true }).click();
    await clickModalButton(page, '刪除');   // ConfirmModal 的 confirmText = common.delete
    console.log(`  toast：${await readToast(page).catch(() => '(沒有 toast)')}`);
    await waitToastGone(page);

    rows = await sql(`select id from campaigns where id='${campaignId}';`, REF);
    check('刪除 → DB 那一列真的不見了', rows.length === 0, JSON.stringify(rows));
    await shot(page, 'campaigns-04-deleted');

    /* ------------------------------------------------ 行銷推播 */
    await gotoStable(page, `${BASE}/tenant/marketing`);
    await shot(page, 'marketing-01-list');

    await page.getByRole('button', { name: '建立推播', exact: true }).first().click();
    await page.locator('#pushTitle').fill(PUSH_TITLE);
    await page.locator('#pushContent').fill(`${TAG} 的推播內容`);
    await clickModalButton(page, '儲存');
    console.log(`  toast：${await readToast(page).catch(() => '(沒有 toast)')}`);
    await waitToastGone(page);

    let pushes = await sql(
      `select id, status, content->>'text' as text from marketing_pushes
       where tenant_id='${TENANT_A}' and title='${q(PUSH_TITLE)}';`,
      REF,
    );
    check('建立推播 → marketing_pushes 真的多一列', pushes.length === 1, JSON.stringify(pushes));
    check('推播內容真的寫進 content.text',
      pushes[0] && pushes[0].text === `${TAG} 的推播內容`, pushes[0] && pushes[0].text);
    const pushId = pushes[0] && pushes[0].id;
    await shot(page, 'marketing-02-created');

    // 「預估人數」未知 → --
    const mkText = await page.locator('body').innerText();
    check('預估人數未知時顯示 --，不是 0 人',
      mkText.includes('--') && !new RegExp(`${TAG}[\\s\\S]{0,120}?\\b0 人`).test(mkText),
      '（沒有試算受眾端點，名單是發送當下才算的）');

    // 刪除
    await page.getByRole('row', { name: new RegExp(TAG) })
      .getByRole('button', { name: '刪除推播', exact: true }).click();
    await clickModalButton(page, '刪除');
    console.log(`  toast：${await readToast(page).catch(() => '(沒有 toast)')}`);
    await waitToastGone(page);

    pushes = await sql(`select id from marketing_pushes where id='${pushId}';`, REF);
    check('刪除推播 → DB 那一列真的不見了', pushes.length === 0, JSON.stringify(pushes));
    await shot(page, 'marketing-03-deleted');
  } catch (e) {
    check('腳本執行完成', false, e && e.message);
    await shot(page, 'marketing-campaigns-99-error').catch(() => {});
  } finally {
    // 收尾：本腳本造出的資料全刪（失敗中斷時也要清）
    await sql(`delete from campaigns where tenant_id='${TENANT_A}' and name like '${q(TAG)}%';`, REF)
      .catch(() => {});
    await sql(`delete from marketing_pushes where tenant_id='${TENANT_A}' and title like '${q(TAG)}%';`, REF)
      .catch(() => {});
    await browser.close();
  }

  const { fail } = summary();
  process.exit(fail > 0 ? 1 : 0);
})();
