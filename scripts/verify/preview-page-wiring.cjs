/**
 * Preview 站「頁面接線」實測 —— 補 CLAUDE.md 記著的結構性盲點那一層。
 *
 * 整合測試已經證明「端點做對的事」；本腳本要證明的是**使用者在部署好的網站上
 * 真的用得到**。因此：
 *
 *   ⚠️ toast 不是證據。這幾輪抓到的每一個假成功，畫面上都有一則漂亮的成功訊息。
 *      本腳本的判準一律是「**重新整理後還在嗎**」或「**直查資料庫對得上嗎**」。
 *      toast 只在「文案是否依實際情況分岔」那一項（B）本身就是待驗標的時才斷言。
 *   ⚠️ 測不到就記 BLOCKED，不打勾。沒有截圖與斷言輸出的項目一律算未驗證。
 *
 * 驗收路徑（依 14 分冊 §6.4／§6.5／§6.6）：
 *   A. issue #27 AI 客服設定  —— ①②③
 *   B. issue #27 預約變更通知文案 —— ④⑤
 *   C. issue #5  關鍵字回覆      —— ⑥⑦⑧
 *   D. issue #28 分類欄位與回報問題 —— ⑨⑩⑪
 *
 * ── 執行（sandbox 專屬參數見 15 分冊 §5）──────────────────────────────────
 *   NODE_USE_ENV_PROXY=1 TEST_EMAIL=... TEST_PASSWORD=... SUPABASE_ACCESS_TOKEN=... \
 *     node scripts/verify/preview-page-wiring.cjs [A] [B] [C] [D]
 *   不帶參數＝跑全部。截圖輸出到 scripts/verify/out/pv-*.png。
 *
 * ⚠️ 本腳本會**寫入正式 Supabase 專案**（Preview 站接的就是它）：AI 設定、
 *   LINE 預設回覆、一組關鍵字、一個分類、一筆 bug_reports、（B 的前置）一個
 *   服務與一筆預約。除 bug_reports 依驗收要求刻意保留外，其餘一律在該階段
 *   結束時還原／刪除，收尾會印出殘留物清單。
 */
const lib = require('./_preview-lib.cjs');

const { BASE, check, blocked, summary, shot, gotoStable, launch, login,
  readToast, waitToastGone, clickModalButton, sql, required } = lib;

const EMAIL = required('TEST_EMAIL');
const PASSWORD = required('TEST_PASSWORD');

/** 這次跑批的識別碼：所有寫進資料庫的字串都帶著它，好清、好認、好比對 */
const RUN = `PV${Date.now().toString().slice(-8)}`;

const leftovers = [];

/* ═══════════════════════════════════════════════ 小工具（頁面元件相依） */

/** SwitchField 的開關：外層 div 有 label 文字，button[role=switch] 是它的兄弟 */
function switchRow(page, labelText) {
  return page.locator('div.flex.items-start.justify-between')
    .filter({ hasText: labelText })
    .locator('button[role="switch"]')
    .first();
}

async function switchState(page, labelText) {
  return (await switchRow(page, labelText).getAttribute('aria-checked')) === 'true';
}

async function setSwitch(page, labelText, want) {
  const sw = switchRow(page, labelText);
  await sw.waitFor({ state: 'visible', timeout: 20_000 });
  if ((await sw.getAttribute('aria-checked')) !== String(want)) await sw.click();
}

/* ════════════════════════════════════════════════════════ A. AI 客服設定 */

async function phaseA(page) {
  console.log('\n═══ A. issue #27 AI 客服設定（/tenant/ai-settings） ═══');

  const PROMPT = `${RUN} 提示詞：請用親切語氣回答，營業時間 10:00-20:00，公休週一。`;
  const CANNED = `${RUN} 罐頭回覆：抱歉我不太懂，請直接留言給小編。`;

  /* --- 前置：先在 line-settings 放一句可辨識的罐頭回覆，才驗得出「不被污染」 --- */
  await gotoStable(page, `${BASE}/tenant/line-settings`);
  const canned = page.locator('#defaultReply');
  if (!(await canned.count())) {
    blocked('①②③ 前置：line-settings 找不到 #defaultReply 欄位');
    return;
  }
  await canned.fill(CANNED);
  // 本頁有兩顆「儲存設定」（LINE 憑證卡、自動回覆卡）→ 只找 #defaultReply 所在那張卡的
  await canned.locator('xpath=ancestor::div[contains(@class,"card-body")][1]')
    .getByRole('button', { name: '儲存設定', exact: true }).first()
    .click({ timeout: 15_000 });
  const cannedToast = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  前置 line-settings 儲存 toast：「${cannedToast}」`);
  await shot(page, 'pv-00-line-settings-canned-set');
  await waitToastGone(page);

  /* --- ① 填提示詞、開啟 AI、開啟嚴格模式 → 儲存 --- */
  await gotoStable(page, `${BASE}/tenant/ai-settings`);
  await page.locator('#aiCustomPrompt').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#aiCustomPrompt').fill(PROMPT);
  await setSwitch(page, '啟用 AI 自動回覆', true);
  await setSwitch(page, '嚴格模式', true);
  await shot(page, 'pv-01-ai-settings-filled');

  await page.getByRole('button', { name: '儲存設定', exact: true }).click();
  const saveToast = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  儲存 toast 原文：「${saveToast}」`);
  await shot(page, 'pv-02-ai-settings-save-toast');

  /* --- ② 重新整理，三個值都要還在（判準不是 toast） --- */
  await gotoStable(page, `${BASE}/tenant/ai-settings`);
  await page.locator('#aiCustomPrompt').waitFor({ state: 'visible', timeout: 30_000 });
  const promptAfter = await page.locator('#aiCustomPrompt').inputValue();
  const enabledAfter = await switchState(page, '啟用 AI 自動回覆');
  const strictAfter = await switchState(page, '嚴格模式');
  await shot(page, 'pv-03-ai-settings-after-reload');

  check('① 重新整理後「提示詞」仍在', promptAfter === PROMPT,
    `讀回：「${promptAfter}」`);
  check('② 重新整理後「啟用 AI 自動回覆」仍為開啟', enabledAfter === true,
    `aria-checked=${enabledAfter}`);
  check('③ 重新整理後「嚴格模式」仍為開啟', strictAfter === true,
    `aria-checked=${strictAfter}`);

  /* 再直查一次資料庫，確認存進的是 tenant_settings.ai 而不是別的欄位 */
  const rows = await sql(
    "select ai->>'personaNotes' as persona, ai->>'enabled' as enabled,"
    + " ai->>'strictMode' as strict, line->>'defaultReply' as canned,"
    + " line->>'autoReplyEnabled' as auto_reply from tenant_settings",
  );
  const r = rows[0] || {};
  console.log('  直查 tenant_settings：', JSON.stringify(r));
  check('①-DB 提示詞存進 tenant_settings.ai.personaNotes', r.persona === PROMPT,
    `DB 值：「${r.persona}」`);
  check('②-DB tenant_settings.ai.enabled = true', String(r.enabled) === 'true',
    `DB 值：${r.enabled}`);
  check('③-DB tenant_settings.ai.strictMode = true', String(r.strict) === 'true',
    `DB 值：${r.strict}`);

  /* --- ③ line-settings 的罐頭回覆沒有被 AI 提示詞污染 --- */
  await gotoStable(page, `${BASE}/tenant/line-settings`);
  await page.locator('#defaultReply').waitFor({ state: 'visible', timeout: 30_000 });
  const cannedAfter = await page.locator('#defaultReply').inputValue();
  await shot(page, 'pv-04-line-settings-not-polluted');

  check('③ line-settings 的「預設回覆」未被 AI 提示詞覆寫', cannedAfter === CANNED,
    `讀回：「${cannedAfter}」`);
  check('③ line-settings 的「預設回覆」不含 AI 提示詞任何片段',
    !cannedAfter.includes('提示詞：') && !cannedAfter.includes(PROMPT),
    `讀回：「${cannedAfter}」`);
  check('③-DB tenant_settings.line.defaultReply 仍是罐頭回覆原文', r.canned === CANNED,
    `DB 值：「${r.canned}」`);

  leftovers.push('tenant_settings.ai（提示詞/啟用/嚴格模式）與 line.defaultReply 已被本腳本改寫，收尾會還原');
}

/** A 階段收尾：把 ai 與 line.defaultReply 還原成測試前的樣子 */
async function restoreA(before) {
  await sql(
    `update tenant_settings set ai = '${JSON.stringify(before.ai).replace(/'/g, "''")}'::jsonb,`
    + ` line = jsonb_set(line, '{defaultReply}', '${JSON.stringify(before.defaultReply).replace(/'/g, "''")}'::jsonb)`,
  );
  console.log('  已還原 tenant_settings.ai 與 line.defaultReply');
}

/* ══════════════════════════════════════════ B. 預約變更通知文案（④⑤） */

async function ensureBookingPrereq(page) {
  // 正式專案的業務資料是空的：④⑤ 需要一筆預約，先用真實 UI 建服務＋預約
  const svc = await sql('select count(*)::int as n from services');
  if (svc[0].n === 0) {
    await gotoStable(page, `${BASE}/tenant/services`);
    await page.getByRole('button', { name: '新增服務', exact: true }).first().click();
    await page.locator('#serviceName').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#serviceName').fill(`${RUN} 測試服務`);
    await page.locator('#servicePrice').fill('1200');
    await page.locator('#serviceDuration').selectOption('60');
    await clickModalButton(page, '儲存');
    await readToast(page).catch(() => '');
    await waitToastGone(page);
    leftovers.push(`services：「${RUN} 測試服務」（B 階段前置，收尾刪除）`);
  }

  const bk = await sql('select count(*)::int as n from bookings');
  if (bk[0].n === 0) {
    await gotoStable(page, `${BASE}/tenant/bookings`);
    await page.getByRole('button', { name: '新增預約', exact: true }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(600);
    // 「新顧客」勾選框：頁面用純 checkbox + 文字，取該 label 底下的 input
    await dialog.locator('label', { hasText: '新顧客（直接輸入姓名與電話）' })
      .locator('input[type=checkbox]').first().check();
    await dialog.locator('input[placeholder="顧客姓名"]').first().fill(`${RUN} 測試顧客`);
    await dialog.locator('input[type=tel]').first().fill('0900000001');
    await page.locator('#bookingService').selectOption({ index: 1 });
    const d = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    await page.locator('#bookingDate').fill(d);
    await page.locator('#checkoutDate').fill(
      new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10),
    );
    await page.locator('#bookingTime').selectOption('14:00');
    await clickModalButton(page, '建立預約');
    await readToast(page).catch(() => '');
    await waitToastGone(page);
    leftovers.push(`bookings + customers：「${RUN} 測試顧客」（B 階段前置，收尾刪除）`);
  }

  const after = await sql('select count(*)::int as n from bookings');
  return after[0].n > 0;
}

async function openBookingEdit(page) {
  await gotoStable(page, `${BASE}/tenant/bookings`);
  const editBtn = page.getByRole('button', { name: '編輯預約' }).first();
  await editBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await editBtn.click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.last().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(700);
  return dialog;
}

/**
 * ④⑤ 的前提：清單上要有一筆可以按「編輯預約」的預約。
 * 這一步在 Preview 站踩到一顆頁面層的硬傷（2026-08-25 實測），所以獨立成一段
 * 並把診斷證據抓齊——「頁面載不出來」與「資料不存在」必須分得開。
 */
async function diagnoseBookingList(page) {
  await gotoStable(page, `${BASE}/tenant/bookings`);
  // 等到表格不再是「載入中…」為止，截圖才拍得到最終狀態而不是中途畫面
  await page.waitForFunction(
    () => !document.querySelector('main')?.innerText.includes('載入中'),
    null, { timeout: 30_000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);
  const toastText = await page.locator('[role="status"]').allInnerTexts()
    .then((a) => a.join(' | ')).catch(() => '');
  const mainText = await page.locator('main').innerText().catch(() => '');
  await shot(page, 'pv-05-bookings-list-load');

  const dbCount = (await sql('select count(*)::int as n from bookings'))[0].n;
  console.log(`  資料庫的預約筆數：${dbCount}`);
  console.log(`  清單頁 toast：「${toastText}」`);

  // 直接用登入後的 session 打端點，把「頁面送的 size=200」與「上限 100」攤開
  const probe = await page.evaluate(async () => {
    const out = {};
    for (const size of [200, 100]) {
      const r = await fetch(`/api/bookings?page=0&size=${size}`, { credentials: 'include' });
      out[size] = { status: r.status, body: (await r.text()).slice(0, 300) };
    }
    return out;
  });
  console.log('  端點探測 /api/bookings：', JSON.stringify(probe, null, 2));

  const editCount = await page.getByRole('button', { name: '編輯預約' }).count();
  return { dbCount, toastText, mainText, probe, editCount };
}

/**
 * ④⑤ 被擋住之後的補充探測——**刻意不記成驗收項**（15 分冊 §2：沒有輸出的主張
 * 不是證據；反過來說，端點的輸出也不是頁面文案的證據）。
 *
 * 目的只有一個：讓報告能說清楚「④⑤ 到底有多少風險是真的未知」。
 *   (a) 端點的 notifyTriggered 在兩種改動下分別回什麼；
 *   (b) 同一顆 size 上限踩到的其他頁面（points）是不是也載不出來。
 * 頁面文案本身仍算「未能驗證」，因為那段 handler 從來沒有在部署環境被執行過。
 */
async function bookingProbes(page) {
  console.log('\n  ── 補充探測（非驗收項，僅供報告評估殘餘風險）──');

  const probe = await page.evaluate(async () => {
    const list = await (await fetch('/api/bookings?page=0&size=100',
      { credentials: 'include' })).json();
    const b = list?.data?.content?.[0];
    if (!b) return { error: '清單端點沒有回傳任何預約' };
    const put = async (body) => {
      const r = await fetch(`/api/bookings/${b.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.text() };
    };
    const noteOnly = await put({ startAt: b.startAt, staffId: b.staffId ?? null, note: `probe ${Date.now()}` });
    const shifted = new Date(Date.parse(b.startAt) + 3600_000).toISOString();
    const timeChanged = await put({ startAt: shifted, staffId: b.staffId ?? null, note: 'probe' });
    return { bookingNo: b.bookingNo, noteOnly, timeChanged };
  });
  console.log('  (a) PUT /api/bookings/:id：', JSON.stringify(probe, null, 2));

  await gotoStable(page, `${BASE}/tenant/points`);
  await page.waitForTimeout(2500);
  const pointsToast = await page.locator('[role="status"]').allInnerTexts()
    .then((a) => a.join(' | ')).catch(() => '');
  await shot(page, 'pv-09b-points-same-size-cap');
  console.log(`  (b) /tenant/points toast：「${pointsToast}」`);
}

async function phaseB(page) {
  console.log('\n═══ B. issue #27 預約變更通知文案（/tenant/bookings） ═══');

  const ready = await ensureBookingPrereq(page).catch((e) => {
    console.log(`  前置建立失敗：${e.message}`);
    return false;
  });
  if (!ready) {
    await shot(page, 'pv-05-bookings-prereq-failed');
    blocked('④⑤ 無法建立可編輯的預約，本組未能驗證');
    return;
  }

  const d = await diagnoseBookingList(page);
  if (d.editCount === 0) {
    check('④⑤ 前提：預約清單頁載得出已存在的預約', false,
      `資料庫有 ${d.dbCount} 筆預約，畫面卻是「${d.mainText.includes('目前沒有預約') ? '目前沒有預約' : '(非空清單但無編輯鈕)'}」`
      + `，toast：「${d.toastText}」；/api/bookings size=200 → HTTP ${d.probe['200'].status}，`
      + `size=100 → HTTP ${d.probe['100'].status}`);
    blocked('④ 只改備註的通知文案',
      '清單載不出來 → 按不到「編輯預約」→ 編輯視窗打不開，本項未能驗證');
    blocked('⑤ 改時間的通知文案',
      '同上，未能驗證');
    await bookingProbes(page);
    return;
  }
  check('④⑤ 前提：預約清單頁載得出已存在的預約', true,
    `資料庫 ${d.dbCount} 筆，畫面上有 ${d.editCount} 顆「編輯預約」`);

  /* --- ④ 只改備註 → toast 必須是「未送出顧客通知」那一句 --- */
  await openBookingEdit(page);
  await page.locator('#bookingNote').fill(`${RUN} 只改備註 ${Date.now()}`);
  await shot(page, 'pv-06-booking-note-only');
  await clickModalButton(page, '儲存變更');
  const t4 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ④ toast 原文：「${t4}」`);
  await shot(page, 'pv-07-booking-note-only-toast');
  check('④ 只改備註 → 顯示「未送出顧客通知」',
    t4.includes('預約已更新（未送出顧客通知）'),
    `toast 原文：「${t4}」`);
  check('④ 只改備註 → 沒有宣稱送出通知',
    !t4.includes('已送出變更通知'),
    `toast 原文：「${t4}」`);
  await waitToastGone(page);

  /* --- ⑤ 改時間 → toast 必須變成「已送出」那一句 --- */
  const dialog = await openBookingEdit(page);
  const cur = await page.locator('#bookingTime').inputValue();
  const opts = await page.locator('#bookingTime option').evaluateAll(
    (els) => els.map((e) => e.value).filter(Boolean),
  );
  const next = opts.find((v) => v !== cur);
  if (!next) {
    blocked('⑤ 時間下拉沒有第二個可選值，無法製造「時間有變」');
    return;
  }
  await page.locator('#bookingTime').selectOption(next);
  console.log(`  ⑤ 時間 ${cur} → ${next}`);
  await shot(page, 'pv-08-booking-time-changed');
  await clickModalButton(page, '儲存變更');
  const t5 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑤ toast 原文：「${t5}」`);
  await shot(page, 'pv-09-booking-time-changed-toast');
  check('⑤ 改時間 → 顯示「已送出變更通知給顧客」',
    t5.includes('已送出變更通知給顧客'),
    `toast 原文：「${t5}」`);
  check('⑤ 兩次操作的文案確實分岔', t4 !== t5,
    `④「${t4}」／⑤「${t5}」`);
  await waitToastGone(page);
  void dialog;
}

/* ══════════════════════════════════════════════ C. 關鍵字回覆（⑥⑦⑧） */

async function phaseC(page) {
  console.log('\n═══ C. issue #5 關鍵字回覆（/tenant/keyword-replies） ═══');

  const KW = `${RUN}停車`;
  const REPLY = `${RUN} 巷口左轉 50 公尺有付費停車場。`;

  /* --- ⑥ 新增 → 重新整理 → 還在 --- */
  await gotoStable(page, `${BASE}/tenant/keyword-replies`);
  await page.getByRole('button', { name: '新增關鍵字', exact: true }).first().click();
  await page.locator('#kwKeyword').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#kwKeyword').fill(KW);
  await page.locator('#kwReplyText').fill(REPLY);
  await shot(page, 'pv-10-keyword-new-filled');
  await clickModalButton(page, '儲存');
  const tc = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑥ toast 原文：「${tc}」`);
  await waitToastGone(page);

  await gotoStable(page, `${BASE}/tenant/keyword-replies`);
  const rowAfterCreate = page.locator('tbody tr', { hasText: KW });
  const existsAfterReload = (await rowAfterCreate.count()) > 0;
  await shot(page, 'pv-11-keyword-after-reload');
  check('⑥ 新增的關鍵字重新整理後仍在清單上', existsAfterReload,
    existsAfterReload ? `找到列：${KW}` : `清單上找不到「${KW}」`);

  const dbAfterCreate = await sql(
    `select keywords, content, active from keyword_replies where keywords::text like '%${KW}%'`,
  );
  console.log('  ⑥ 直查 keyword_replies：', JSON.stringify(dbAfterCreate));
  check('⑥-DB keyword_replies 真的有這一列', dbAfterCreate.length === 1,
    `查到 ${dbAfterCreate.length} 列`);

  if (!existsAfterReload) {
    blocked('⑦⑧ 前提（⑥）不成立，停用／刪除無法接續驗證');
    return;
  }

  /* --- ⑦ 停用 → 重新整理 → 停用狀態保留 --- */
  await rowAfterCreate.locator('button[role="switch"]').first().click();
  const t7 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑦ toast 原文：「${t7}」`);
  await shot(page, 'pv-12-keyword-disabled-toast');
  await waitToastGone(page);

  await gotoStable(page, `${BASE}/tenant/keyword-replies`);
  const row7 = page.locator('tbody tr', { hasText: KW });
  const stillThere = (await row7.count()) > 0;
  const checkedAfter = stillThere
    ? await row7.locator('button[role="switch"]').first().getAttribute('aria-checked')
    : '(找不到列)';
  await shot(page, 'pv-13-keyword-disabled-after-reload');
  check('⑦ 停用後重新整理，開關仍為關閉', checkedAfter === 'false',
    `aria-checked=${checkedAfter}`);

  const dbAfterDisable = await sql(
    `select active from keyword_replies where keywords::text like '%${KW}%'`,
  );
  console.log('  ⑦ 直查 keyword_replies.active：', JSON.stringify(dbAfterDisable));
  check('⑦-DB keyword_replies.active = false',
    dbAfterDisable.length === 1 && dbAfterDisable[0].active === false,
    JSON.stringify(dbAfterDisable));

  /* --- ⑧ 刪除 → 重新整理 → 真的沒了 --- */
  await row7.getByRole('button', { name: '刪除' }).first().click();
  await clickModalButton(page, '刪除');
  const t8 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑧ toast 原文：「${t8}」`);
  await waitToastGone(page);

  await gotoStable(page, `${BASE}/tenant/keyword-replies`);
  const goneOnPage = (await page.locator('tbody tr', { hasText: KW }).count()) === 0;
  await shot(page, 'pv-14-keyword-deleted-after-reload');
  check('⑧ 刪除後重新整理，清單上真的沒了', goneOnPage,
    goneOnPage ? '清單無此列' : '清單上仍看得到');

  const dbAfterDelete = await sql(
    `select count(*)::int as n from keyword_replies where keywords::text like '%${KW}%'`,
  );
  check('⑧-DB keyword_replies 已無此列', dbAfterDelete[0].n === 0,
    `剩 ${dbAfterDelete[0].n} 列`);
  if (dbAfterDelete[0].n > 0) leftovers.push(`keyword_replies：「${KW}」刪不掉，需人工清`);
}

/* ═══════════════════════════════════ D. 分類欄位與回報問題（⑨⑩⑪） */

async function openCategoryModal(page) {
  await gotoStable(page, `${BASE}/tenant/services`);
  await page.getByRole('button', { name: '管理分類', exact: true }).first()
    .click({ timeout: 20_000 });
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(700);
  return dialog;
}

async function phaseD(page) {
  console.log('\n═══ D. issue #28 分類欄位與回報問題 ═══');

  const CAT = `${RUN}分類`;
  const DESC = `${RUN} 這是分類說明，重整後應該還在`;

  /* --- ⑨ 新增分類時填說明 → 重新整理 → 說明還在 --- */
  let dialog = await openCategoryModal(page);
  await page.locator('#newCategoryName').fill(CAT);
  await page.locator('#newCategoryDesc').fill(DESC);
  await shot(page, 'pv-15-category-filled');
  await dialog.getByRole('button', { name: '新增', exact: true }).first().click();
  const t9 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑨ toast 原文：「${t9}」`);
  await waitToastGone(page);
  await page.waitForTimeout(1500); // create 是 fire-and-forget 的 .then()，等它回來

  dialog = await openCategoryModal(page);
  const catRow = dialog.locator('tbody tr', { hasText: CAT });
  const catExists = (await catRow.count()) > 0;
  const rowText = catExists ? await catRow.first().innerText() : '(找不到列)';
  await shot(page, 'pv-16-category-after-reload');
  check('⑨ 重新整理後分類仍在', catExists, `列內容：${rowText.replace(/\s+/g, ' ')}`);
  check('⑨ 重新整理後「說明」欄仍是填入的內容', rowText.includes(DESC),
    `列內容：${rowText.replace(/\s+/g, ' ')}`);

  const dbCat = await sql(
    `select id, name, description, active from service_categories where name = '${CAT}'`,
  );
  console.log('  ⑨ 直查 service_categories：', JSON.stringify(dbCat));
  check('⑨-DB service_categories.description 對得上',
    dbCat.length === 1 && dbCat[0].description === DESC,
    JSON.stringify(dbCat));

  if (!catExists) {
    blocked('⑩ 前提（⑨）不成立，啟用切換無法接續驗證');
  } else {
    /* --- ⑩ 按編輯鈕切換啟用 → 重新整理 → 狀態保留 --- */
    const beforeActive = dbCat[0]?.active;
    await catRow.first().getByRole('button', { name: '編輯', exact: true }).first().click();
    const t10 = await readToast(page).catch(() => '(沒有出現 toast)');
    console.log(`  ⑩ toast 原文：「${t10}」`);
    await shot(page, 'pv-17-category-toggled-toast');
    await waitToastGone(page);

    dialog = await openCategoryModal(page);
    const catRow2 = dialog.locator('tbody tr', { hasText: CAT });
    const rowText2 = (await catRow2.count()) ? await catRow2.first().innerText() : '(找不到列)';
    await shot(page, 'pv-18-category-toggled-after-reload');
    check('⑩ 重新整理後狀態顯示為「停用」', rowText2.includes('停用'),
      `列內容：${rowText2.replace(/\s+/g, ' ')}`);

    const dbCat2 = await sql(
      `select active from service_categories where name = '${CAT}'`,
    );
    console.log('  ⑩ 直查 service_categories.active：', JSON.stringify(dbCat2));
    check('⑩-DB active 由 true 翻成 false',
      beforeActive === true && dbCat2.length === 1 && dbCat2[0].active === false,
      `之前 ${beforeActive} → 現在 ${JSON.stringify(dbCat2)}`);
  }

  // 收尾：把測試分類刪掉（透過 UI 的刪除鈕，順便驗它也是真的）
  dialog = await openCategoryModal(page);
  const delRow = dialog.locator('tbody tr', { hasText: CAT });
  if (await delRow.count()) {
    await delRow.first().getByRole('button', { name: '刪除', exact: true }).first().click();
    await clickModalButton(page, '刪除');
    await readToast(page).catch(() => '');
    await waitToastGone(page);
  }
  const leftCat = await sql(`select count(*)::int as n from service_categories where name='${CAT}'`);
  if (leftCat[0].n > 0) leftovers.push(`service_categories：「${CAT}」未刪除，需人工清`);

  /* --- ⑪ 回報問題：填四個欄位送出 → 直查 bug_reports 比對四欄 --- */
  const SUBJ = `${RUN} 回報標題`;
  const BODY = `${RUN} 詳細說明：這是頁面層實測寫入的一筆回報，用來驗證四個欄位真的進了 bug_reports。`;
  const MAIL = `pv-${RUN.toLowerCase()}@example.com`;
  const CATEGORY = 'DISPLAY';

  await gotoStable(page, `${BASE}/tenant/dashboard`);
  const bugBtn = page.getByRole('button', { name: '回報問題' }).first();
  if (!(await bugBtn.count())) {
    await shot(page, 'pv-19-bugreport-button-missing');
    blocked('⑪ 找不到右下角「回報問題」按鈕（lg 以上才顯示，viewport 已設 1440）');
    return;
  }
  await bugBtn.click();
  await page.locator('#bugSubject').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#bugCategory').selectOption(CATEGORY);
  await page.locator('#bugSubject').fill(SUBJ);
  await page.locator('#bugDesc').fill(BODY);
  await page.locator('#bugEmail').fill(MAIL);
  await shot(page, 'pv-20-bugreport-filled');
  await clickModalButton(page, '送出回報');
  const t11 = await readToast(page).catch(() => '(沒有出現 toast)');
  console.log(`  ⑪ toast 原文：「${t11}」`);
  await shot(page, 'pv-21-bugreport-submitted');
  await waitToastGone(page);

  // 判準是直查，不是 toast
  const bugs = await sql(
    "select category, subject, content, contact_email, page_url, reporter,"
    + ` created_at from bug_reports where subject = '${SUBJ}'`,
  );
  console.log('  ⑪ 直查 bug_reports：\n' + JSON.stringify(bugs, null, 2));
  check('⑪ bug_reports 有且只有一筆對應的回報', bugs.length === 1,
    `查到 ${bugs.length} 筆`);
  const b = bugs[0] || {};
  check('⑪-欄1 category 相符', b.category === CATEGORY, `DB：${b.category} / 送出：${CATEGORY}`);
  check('⑪-欄2 subject 相符', b.subject === SUBJ, `DB：${b.subject}`);
  check('⑪-欄3 content 相符', b.content === BODY, `DB：${b.content}`);
  check('⑪-欄4 contact_email 相符', b.contact_email === MAIL,
    `DB：${b.contact_email} / 送出：${MAIL}`);
  if (bugs.length) leftovers.push(`bug_reports：「${SUBJ}」（驗收證據，刻意保留）`);
}

/* ═══════════════════════════════════════════════════════════════ main */

(async () => {
  const want = process.argv.slice(2).map((s) => s.toUpperCase());
  const run = (k) => want.length === 0 || want.includes(k);

  // 測試前的原值，A 階段結束要還原
  const before0 = await sql("select coalesce(ai,'{}'::jsonb) as ai, line->>'defaultReply' as dr"
    + ' from tenant_settings');
  const before = { ai: before0[0].ai, defaultReply: before0[0].dr ?? '' };
  console.log('測試前 tenant_settings：', JSON.stringify(before));

  const browser = await launch();
  let failed = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await login(page, EMAIL, PASSWORD);
    console.log(`登入成功：${page.url()}`);

    const phases = [['A', phaseA], ['B', phaseB], ['C', phaseC], ['D', phaseD]];
    for (const [key, fn] of phases) {
      if (!run(key)) continue;
      try {
        await fn(page);
      } catch (e) {
        await shot(page, `pv-error-${key}`).catch(() => {});
        blocked(`階段 ${key} 中斷`, e.message);
      }
    }
  } finally {
    await browser.close();
    if (run('A')) await restoreA(before).catch((e) => console.log('還原失敗：', e.message));
    const s = summary();
    failed = s.fail;
    if (leftovers.length) {
      console.log('\n殘留物（人工確認）：');
      for (const l of leftovers) console.log(`  - ${l}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
