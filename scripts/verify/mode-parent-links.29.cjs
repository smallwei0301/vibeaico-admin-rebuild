/**
 * issue #29 實測：三種模式下，儀表板／行事曆／商品訂單頁的每一個站內連結，
 * 都必須落在**該模式側邊欄裡真的有的頁面**。
 *
 * 這是本 issue 真正要證明的事——不是「程式碼改了」，是「嚮導不會再走進死路」。
 *
 * ⚠️ 測的是**本機 next dev**（http://localhost:3000，NEXT_PUBLIC_USE_MOCK=true），
 *    不是 Preview 站：Preview 部署的是已 push 的 commit，本輪改動還沒 push。
 *
 * sandbox 參數照 docs/integration/15-AGENT-PLAYBOOK.md §5 抄。
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TENANTS = [
  { id: 't_1', mode: 'GUIDE', name: '祕島嚮導工作室' },
  { id: 't_2', mode: 'LOCAL_SHOP', name: '示範美髮沙龍' },
  { id: 't_3', mode: 'CLINIC', name: '示範診所' },
];
const PAGES = ['/tenant/dashboard', '/tenant/calendar', '/tenant/product-orders'];

/** 三種模式的「訂單」父層級頁（= MODE_PRESETS[mode].ordersHref，此處寫死是為了獨立驗證） */
const ordersHrefOf = (mode) =>
  ({ LOCAL_SHOP: '/tenant/bookings', GUIDE: '/tenant/tour-orders', CLINIC: '/tenant/bookings' }[mode]);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    proxy: { server: process.env.HTTPS_PROXY, bypass: '<-loopback>,localhost,127.0.0.1' },
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
      '--ssl-version-max=tls1.2',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  let failures = 0;

  for (const t of TENANTS) {
    await page.goto(`${BASE}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((id) => localStorage.setItem('vibeai.tenant.id', id), t.id);
    await page.goto(`${BASE}/tenant/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    /*
     * 側邊欄實際看得到的頁面。
     * 群組是手風琴（Sidebar.tsx：`同時只展開一組`），且收合時子項**根本不渲染**，
     * 所以必須一組一組點開、逐次累加——一次全點只會留下最後一組。
     */
    const sidebarSet = new Set(
      await page.$$eval('.sidebar > ul > li > a[href^="/tenant/"]',
        (as) => as.map((a) => a.getAttribute('href'))),
    );
    const groupCount = (await page.$$('.sidebar button[aria-expanded]')).length;
    for (let g = 0; g < groupCount; g += 1) {
      const btns = await page.$$('.sidebar button[aria-expanded]');
      if (!btns[g]) break;
      if ((await btns[g].getAttribute('aria-expanded')) !== 'true') {
        await btns[g].click().catch(() => {});
        await page.waitForTimeout(200);
      }
      const subs = await page.$$eval('.sidebar .sidebar-sub-nav a[href^="/tenant/"]',
        (as) => as.map((a) => a.getAttribute('href')));
      for (const h of subs) sidebarSet.add(h);
    }

    console.log(`\n================ ${t.mode}（${t.name}）================`);
    console.log(`側邊欄可見頁面（${sidebarSet.size}）：${[...sidebarSet].sort().join(' ')}`);

    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      if (path === '/tenant/product-orders') {
        /*
         * 「來源預約」與「相關預約」兩條連結只在**明細 Modal**裡、而且該筆訂單
         * 要有 bookingId / fromBooking 才會渲染。逐列開啟明細（眼睛鈕）找找看。
         */
        const eyes = await page.$$('table tbody tr button[aria-label]');
        let opened = false;
        for (let i = 0; i < eyes.length; i += 1) {
          const btns = await page.$$('table tbody tr button[aria-label]');
          await btns[i].click().catch(() => {});
          await page.waitForTimeout(600);
          // 只認「指向該模式訂單頁」的連結，不能被明細裡的『聊天』連結騙過去
          const got = await page.$$eval('.modal-content a[href^="/tenant/"]',
            (as) => as.map((a) => a.getAttribute('href'))).catch(() => []);
          if (got.some((h) => h.split('?')[0] === ordersHrefOf(t.mode))) { opened = true; break; }
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(250);
        }
        if (!opened) {
          console.log(`\n  --- ${path} ---`);
          console.log('  [N/A ] 「來源預約 / 相關預約」兩條連結在明細 Modal 內，'
            + '但 src/mock 的 productOrders 沒有任何一筆帶 bookingId / fromBooking，');
          console.log('         所以**本輪瀏覽器實測無法觸發這兩條**（不是通過，是沒測到）。'
            + '改由 tests/unit/mode-parent-links.29.test.ts 的路徑靜態鎖把關。');
          continue;
        }
      }

      // 主內容區的站內連結（排除側邊欄與 topbar）
      const links = await page.$$eval(
        '.content-area a[href^="/tenant/"], .modal-content a[href^="/tenant/"]',
        (as) => as.map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 24) })));

      const seen = new Map();
      for (const l of links) if (!seen.has(`${l.href}|${l.text}`)) seen.set(`${l.href}|${l.text}`, l);

      console.log(`\n  --- ${path} ---`);
      for (const { href, text } of seen.values()) {
        const base = href.split('?')[0];
        const inMenu = sidebarSet.has(base);
        const ok = inMenu ? 'OK ' : 'MISS';
        if (!inMenu) failures += 1;
        console.log(`  [${ok}] ${text.padEnd(14)} → ${href}${inMenu ? '' : '   ← 不在他的選單裡'}`);
      }
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/${t.mode}${path.replace(/\//g, '_')}.png`,
        fullPage: false,
      });
    }
  }

  console.log(`\n=========== 結果：${failures === 0 ? '全部連結都落在該模式的選單內' : failures + ' 個連結落在選單外'} ===========`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
