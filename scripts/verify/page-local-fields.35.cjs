/**
 * issue #35 Preview 實測：把畫面欄位逐字／逐數字和資料庫直查結果相比。
 *
 * 不以「畫面有數字」當成功。本腳本先用 Management API 查出測試帳號所屬租戶，
 * 找到真的含 coupon_discount / points_redeemed 的預約，以及含 issue #35 新欄位的
 * 票券，再登入同一個 Preview 站打開詳情視窗逐項比對並截圖。
 *
 * 必要環境變數：PREVIEW_URL、TEST_EMAIL、TEST_PASSWORD、SUPABASE_ACCESS_TOKEN。
 * 本腳本唯讀，不新增、修改或刪除資料。
 */
const {
  BASE, required, check, blocked, summary, shot,
  gotoStable, launch, login, sql,
} = require('./_preview-lib.cjs');

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
const money = (value) => `NT$${Number(value).toLocaleString('en-US')}`;

async function tenantIdFor(email) {
  const [row] = await sql(`
    select tu.tenant_id
    from tenant_users tu
    join auth.users u on u.id = tu.user_id
    where lower(u.email) = lower(${sqlLiteral(email)})
    order by tu.created_at
    limit 1`);
  if (!row?.tenant_id) throw new Error(`找不到 ${email} 所屬租戶`);
  return row.tenant_id;
}

async function verifyDeployment() {
  const expected = required('EXPECTED_COMMIT_SHA');
  const token = required('VERCEL_TOKEN');
  const host = new URL(BASE).hostname;
  const response = await fetch(`https://api.vercel.com/v13/deployments/${host}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Vercel deployment 查詢失敗 ${response.status}`);
  const actual = body?.meta?.githubCommitSha;
  check('Preview deployment SHA 等於本輪受測 HEAD', actual === expected,
    `expected=${expected} actual=${actual || 'missing'}`);
  if (actual !== expected) throw new Error('Preview 尚未部署受測 HEAD，停止避免驗到舊版');
}

async function bookingEvidence(tenantId) {
  const [row] = await sql(`
    select id, booking_no, coupon_discount, points_redeemed, final_price
    from bookings
    where tenant_id = ${sqlLiteral(tenantId)}
      and coalesce(coupon_discount, 0) > 0
      and coalesce(points_redeemed, 0) > 0
    order by created_at desc
    limit 1`);
  return row || null;
}

async function couponEvidence(tenantId) {
  return sql(`
    select id, name, type, min_order_amount, max_discount_amount,
           gift_item, limit_per_customer, private_mode
    from coupons
    where tenant_id = ${sqlLiteral(tenantId)}
      and ((type = 'DISCOUNT_AMOUNT' and min_order_amount is not null)
        or (type = 'DISCOUNT_PERCENT' and max_discount_amount is not null)
        or (type = 'GIFT' and nullif(gift_item, '') is not null)
        or limit_per_customer is not null or private_mode is true)
    order by created_at desc
    limit 20`);
}

async function openBooking(page, row) {
  await gotoStable(page, `${BASE}/tenant/bookings`);
  const search = page.getByPlaceholder('搜尋顧客姓名或電話...');
  await search.waitFor({ state: 'visible', timeout: 45_000 });
  await search.fill(row.booking_no);
  await search.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  const bookingRow = page.locator('tr', { hasText: row.booking_no });
  await bookingRow.waitFor({ state: 'visible', timeout: 30_000 });
  await bookingRow.getByRole('button', { name: /查看/ }).click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  const text = await dialog.innerText();
  check('預約詳情的應收金額等於 DB final_price', text.includes(money(row.final_price)),
    `expected=${money(row.final_price)} booking=${row.booking_no}`);
  check('預約詳情的票券折抵等於 DB coupon_discount',
    text.includes(`票券折抵 ${money(row.coupon_discount)}`),
    `expected=${money(row.coupon_discount)}`);
  check('預約詳情的點數折抵等於 DB points_redeemed',
    text.includes(`點數折抵 ${Number(row.points_redeemed).toLocaleString('en-US')} 點`),
    `expected=${row.points_redeemed} 點`);
  await shot(page, 'issue35-booking-db-match');
}

async function openCoupon(page, row, index) {
  await gotoStable(page, `${BASE}/tenant/coupons`);
  const search = page.getByPlaceholder(/搜尋/).first();
  if (await search.count()) {
    await search.fill(row.name);
    await search.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  }
  const matchingRows = page.locator('tr', { hasText: row.name });
  const count = await matchingRows.count();
  check(`票券「${row.name}」搜尋結果唯一`, count === 1, `rows=${count} id=${row.id}`);
  if (count !== 1) throw new Error(`無法唯一定位票券 ${row.name} (${row.id})`);
  await matchingRows.first().getByRole('button', { name: /查看/ }).click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  await dialog.getByText('載入中...').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  const text = await dialog.innerText();
  check(`票券「${row.name}」詳情名稱和 DB 一致`, text.includes(row.name));
  if (row.min_order_amount !== null) {
    check('最低消費金額和 DB 一致',
      new RegExp(`最低消費：\\s*${money(row.min_order_amount).replace('$', '\\$')}`).test(text),
      `${row.name}: DB=${row.min_order_amount}`);
  }
  if (row.max_discount_amount !== null) {
    check('最高折抵金額和 DB 一致',
      new RegExp(`最高折抵：\\s*${money(row.max_discount_amount).replace('$', '\\$')}`).test(text),
      `${row.name}: DB=${row.max_discount_amount}`);
  }
  if (row.gift_item) {
    check('兌換項目和 DB 一致', text.includes(`兌換項目：${row.gift_item}`),
      `${row.name}: DB=${row.gift_item}`);
  }
  if (row.limit_per_customer !== null) {
    check('每人限領數量和 DB 一致',
      text.includes(`每人限領數量${Number(row.limit_per_customer).toLocaleString('en-US')}`),
      `${row.name}: DB=${row.limit_per_customer}`);
  }
  if (row.private_mode) {
    check('私密票券狀態和 DB 一致', text.includes('可見範圍：私密'), `${row.name}: DB=true`);
  }
  await shot(page, `issue35-coupon-${index + 1}-db-match`);
}

async function main() {
  const email = required('TEST_EMAIL');
  const password = required('TEST_PASSWORD');
  required('SUPABASE_ACCESS_TOKEN');
  await verifyDeployment();
  const tenantId = await tenantIdFor(email);
  const booking = await bookingEvidence(tenantId);
  const coupons = await couponEvidence(tenantId);

  console.log(`受測站台：${BASE}\n租戶：${tenantId}\n`);
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await login(page, email, password);
    if (booking) await openBooking(page, booking);
    else blocked('預約三欄 DB→畫面比對',
      '租戶沒有 coupon_discount 與 points_redeemed 都大於 0 的代表預約');

    if (coupons.length === 0) {
      blocked('票券五欄 DB→畫面比對', '租戶沒有任何 issue #35 新欄位帶值的票券');
    } else {
      for (let i = 0; i < coupons.length; i += 1) await openCoupon(page, coupons[i], i);
    }
    const covered = {
      min: coupons.some((c) => c.type === 'DISCOUNT_AMOUNT' && c.min_order_amount !== null),
      max: coupons.some((c) => c.type === 'DISCOUNT_PERCENT' && c.max_discount_amount !== null),
      gift: coupons.some((c) => c.type === 'GIFT' && Boolean(c.gift_item)),
      limit: coupons.some((c) => c.limit_per_customer !== null),
      private: coupons.some((c) => c.private_mode === true),
    };
    for (const [field, ok] of Object.entries(covered)) {
      if (!ok) blocked(`票券欄位 ${field} DB→畫面比對`, '沒有符合 UI 顯示條件的代表資料');
    }
  } finally {
    await browser.close();
  }
  const result = summary();
  if (result.fail > 0 || result.skip > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[FAIL] issue #35 Preview 驗證中止：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
