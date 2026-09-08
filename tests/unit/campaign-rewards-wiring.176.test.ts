/**
 * 行銷活動獎勵接線的不可回歸鎖（issue #176 第 2、3 項）
 * -----------------------------------------------------------------------------
 * ## 這一檔證明什麼、不證明什麼
 *
 * ⚠️ **本檔多數斷言讀的是原始碼與 SQL 文字，文字對了不代表跑得起來。**
 * #218 的 `0090` 就是活生生的例子：SQL 文字完全正確，但 `returns table` 的 OUT
 * 名稱與欄位撞名，**每一次呼叫**都在執行期丟 ambiguous，而讀文字的單元測試全綠。
 * 真正的執行證據是 `tests/integration/api/campaign-rewards.176.test.ts`（打真的
 * 資料庫）與 migration 套用時的行為。這裡鎖的是「兩端不會各自漂移」與「幾個一旦
 * 寫錯就會靜默失效的形狀」，不是「功能會動」。這一段寫在最前面，是為了不讓下一個
 * 人把本檔全綠當成功能可用（PB-029）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { REWARDABLE_TYPES, isWithinWindow } from '@/server/campaign-rewards';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const MIGRATION = read('../../supabase/migrations/0091_campaign_reward_grants.sql');
const ENGINE = read('../../src/server/campaign-rewards.ts');
const PAGE = read('../../src/app/tenant/campaigns/page.tsx');
const COMPLETE_ROUTE = read('../../src/app/api/bookings/[id]/complete/route.ts');
const LINE_EVENTS = read('../../src/server/line-events.ts');
const BATCH_ISSUE = read('../../src/app/api/coupons/[id]/batch-issue/route.ts');

describe('前端說「會發」與後端真的有觸發點，兩端不得漂移', () => {
  it('頁面的 REWARD_ACTIVE_TYPES 與 server 的 REWARDABLE_TYPES 是同一組', () => {
    const serverTypes = [
      ...REWARDABLE_TYPES.BOOKING_COMPLETED,
      ...REWARDABLE_TYPES.KEYWORD_CLAIM,
    ].sort();

    const match = PAGE.match(/const REWARD_ACTIVE_TYPES: CampaignType\[\] = \[([^\]]*)\]/);
    expect(match, '頁面找不到 REWARD_ACTIVE_TYPES').toBeTruthy();
    const pageTypes = match![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();

    // 這正是本 issue 一開始要修的那種假象：畫面宣稱會發生的事，後端沒有對應的
    // 觸發點。任一端加了類型而另一端沒跟上，這條就紅。
    expect(pageTypes).toEqual(serverTypes);
  });

  it('REFERRAL 不在會發放的清單裡（推薦碼是 issue #24 的整塊功能）', () => {
    const all = [...REWARDABLE_TYPES.BOOKING_COMPLETED, ...REWARDABLE_TYPES.KEYWORD_CLAIM];
    expect(all).not.toContain('REFERRAL');
    // 所以它必須還看得到「不會自動執行」那則提示
    expect(PAGE).toContain('notImplemented');
  });

  it('BIRTHDAY / RECALL 不在會發放的清單裡（#176 第 1 項裁示 (b) 已導向通知設定）', () => {
    const all = [...REWARDABLE_TYPES.BOOKING_COMPLETED, ...REWARDABLE_TYPES.KEYWORD_CLAIM];
    expect(all).not.toContain('BIRTHDAY');
    expect(all).not.toContain('RECALL');
  });
});

describe('推播訊息仍然不會送出——那句錯的說明必須有獨立的更正', () => {
  it('表單顯示 truthNotice.pushInert', () => {
    // 本輪只做了發券／送點數。三型的 notImplemented 提示消失之後，表單上唯一提到
    // 推播的就只剩 form.pushMessageHelp（「發布時會透過 LINE 推播通知給所有追蹤者」），
    // 那句話是錯的。沒有這則獨立提示，本 PR 反而讓一個假承諾更顯眼。
    expect(PAGE).toContain('t.truthNotice.pushInert');
  });

  it('沒有任何活動流程呼叫 LINE 推播（發布只改狀態）', () => {
    const publish = read('../../src/app/api/campaigns/[id]/publish/route.ts');
    expect(publish).not.toMatch(/linePush|multicast|consumePushQuota/);
  });
});

describe('觸發點真的接在事件上（不是只有函式存在）', () => {
  it('預約完成的 route 有呼叫 grantCampaignRewards', () => {
    expect(COMPLETE_ROUTE).toContain("from '@/server/campaign-rewards'");
    expect(COMPLETE_ROUTE).toContain('grantCampaignRewards(');
    expect(COMPLETE_ROUTE).toContain("trigger: 'BOOKING_COMPLETED'");
  });

  it('新客判定用「COMPLETED 總數 === 1」，且不把 null 當成 0', () => {
    // count 為 null 代表查詢沒有回傳計數，不是 0。寫成 `(count ?? 0) === 1`
    // 會讓新客活動在計數缺失時永遠不發，而且完全靜默。
    expect(COMPLETE_ROUTE).toContain('count === 1');
    expect(COMPLETE_ROUTE).not.toContain('(count ?? 0) === 1');
  });

  it('LINE 活動關鍵字分支有呼叫 grantCampaignRewards，且限定單一活動', () => {
    expect(LINE_EVENTS).toContain("trigger: 'KEYWORD_CLAIM'");
    // onlyCampaignId 確保「打了 A 活動的關鍵字」不會順便把其他限時活動一起領走
    expect(LINE_EVENTS).toContain('onlyCampaignId:');
  });

  it('未綁定顧客時不發放（獎勵無處可寫）', () => {
    expect(LINE_EVENTS).toMatch(/boundCustomerId\(\{[\s\S]{0,200}\}\);\s*\n\s*if \(customerId\)/);
  });
});

describe('migration 0091 的幾個一旦寫錯就會靜默失效的形狀', () => {
  it('冪等鍵是 (tenant_id, campaign_id, customer_id) 唯一約束，且有失敗即報的斷言', () => {
    expect(MIGRATION).toContain('unique (tenant_id, campaign_id, customer_id)');
    // PB-026：create table if not exists 對同名不同形狀的表會靜默跳過
    expect(MIGRATION).toContain('raise exception');
    expect(MIGRATION).toMatch(/冪等保證不成立/);
  });

  it('冪等命中的分支在 return next 之後有 return;（否則冪等完全失效）', () => {
    // PL/pgSQL 的 `return next` 只是把一列加進結果集，不會結束函式。少了 `return;`
    // 後面的發放邏輯照跑，等於這支函式對同一位顧客會重複發放——而且它還是會回
    // 一列 out_granted = false，看起來像擋住了。
    const rawBranch = MIGRATION.slice(
      MIGRATION.indexOf('if v_grant is null then'),
      MIGRATION.indexOf('-- ② 票券'),
    );
    expect(rawBranch.length, '切不到冪等分支').toBeGreaterThan(0);

    /**
     * ⚠️ **必須先把註解拿掉再比對。**
     *
     * 這條測試第一版直接對整段原文跑 `/return next;[\s\S]*\breturn;/`，變異測試
     * 當場證明它是壞的：把真正的 `return;` 語句刪掉之後它**照樣通過**——因為上面
     * 那段解釋用的註解裡就寫著「少了下面這個 `return;`」，正則抓到的是註解文字。
     *
     * 這正是 PB-027 的形狀（數到的是名字，不是那件事），而且發生在一條專門用來
     * 防止冪等靜默失效的鎖上：它會在最需要它的時候給出綠燈。
     */
    const branch = rawBranch.replace(/--[^\n]*/g, '');
    expect(branch).toContain('return next;');
    expect(branch).toMatch(/return next;\s*\breturn;/);
  });

  it('三個 OUT 名稱都加了 out_ 前綴（避開 #218 的 ambiguous 踩點）', () => {
    const start = MIGRATION.indexOf('returns table (');
    const end = MIGRATION.indexOf('language plpgsql');
    // 先確認切得到——切失敗會讓 signature 變成空字串，而空字串會讓下面的
    // not.toMatch 直接通過，這條測試就變成「什麼都沒驗」的假綠（PB-029）。
    expect(start, '找不到 returns table (').toBeGreaterThan(-1);
    expect(end, '找不到 language plpgsql').toBeGreaterThan(start);
    const signature = MIGRATION.slice(start, end);
    for (const name of ['out_granted', 'out_points_after', 'out_coupon_instance']) {
      expect(signature).toContain(name);
    }
    // points_after 是 customer_point_logs 的欄位名；OUT 用同名就會在執行期 ambiguous
    expect(signature).not.toMatch(/^\s*points_after\s/m);
  });

  it('票券限量檢查在 coupons 的列鎖下進行（少了它是 TOCTOU）', () => {
    /**
     * 最後風險評估（`claude-fable-5-1`）在本機 PG16 實測抓到的真缺陷：第一版讀
     * `total_quantity` 沒有 `for update`，而 `count(*)` 在 read committed 下看不到
     * 別的交易未提交的 insert。`total_quantity = 1` 的券被兩位顧客同時領取時
     * **兩邊都通過檢查、兩邊都發出去**（實測 issued = 2 > total = 1）。
     * 限時優惠 ＋ 限量券正是最容易同時發生的場景。
     */
    const couponBranch = MIGRATION.slice(
      MIGRATION.indexOf('-- ② 票券'),
      MIGRATION.indexOf('-- ③ 點數'),
    );
    expect(couponBranch.length, '切不到票券分支').toBeGreaterThan(0);
    const code = couponBranch.replace(/--[^\n]*/g, '');
    expect(code).toMatch(/select total_quantity into v_total[\s\S]*?for update;/);
  });

  it('租戶邊界在搶冪等鍵之前就驗完，campaign 與 customer 都驗', () => {
    /**
     * 同一次評估指出的硬化缺口：第一版只在「有點數要發」時才驗 customer 的租戶、
     * 而且完全沒驗 campaign。這是 security definer 函式（繞過 RLS），不能倚賴
     * 呼叫端「應該只會傳同租戶的 id」。
     * 驗證必須在冪等鍵之前——否則一個驗證失敗的請求會先吃掉那位顧客的冪等鍵。
     */
    const body = MIGRATION.slice(MIGRATION.indexOf('as $$'), MIGRATION.indexOf('-- ① 先搶冪等鍵'))
      .replace(/--[^\n]*/g, '');

    /**
     * ⚠️ 必須連 `tenant_id = p_tenant` 一起釘住。
     *
     * 這條鎖的第一版只驗「在冪等鍵之前有查 campaigns/customers 並 raise」。
     * 第二輪最後風險評估做變異測試時指出：**把 `and tenant_id = p_tenant` 拿掉，
     * 這條不會紅**——查詢還在、raise 還在，但租戶邊界整個消失了，而這支函式是
     * security definer、繞過 RLS。
     *
     * 那正是這一整組鎖存在的理由所在：一條在最需要它的時候給綠燈的測試，
     * 比沒有測試更糟（PB-029）。租戶條件才是這兩句的重點，不是「有沒有查」。
     */
    expect(body).toMatch(
      /from public\.campaigns\s+where id = p_campaign and tenant_id = p_tenant;[\s\S]*?CAMPAIGN_NOT_FOUND/,
    );
    expect(body).toMatch(
      /from public\.customers\s+where id = p_customer and tenant_id = p_tenant;[\s\S]*?CUSTOMER_NOT_FOUND/,
    );
  });

  it('執行權三句都在：撤 PUBLIC、撤兩個角色、只給 service_role', () => {
    // PB-028：revoke ... from anon, authenticated 不會移除 PostgreSQL 給 PUBLIC 的
    // 預設 EXECUTE，而 anon/authenticated 都是 PUBLIC 的成員——只寫後者側門仍開著。
    expect(MIGRATION).toMatch(/revoke all on function public\.grant_campaign_reward\([^)]*\) from public;/);
    expect(MIGRATION).toMatch(/revoke all on function public\.grant_campaign_reward\([^)]*\) from anon, authenticated;/);

    const grants = MIGRATION.match(/grant execute on function[^;]*;/g) ?? [];
    expect(grants).toHaveLength(1);
    // 只看 `to` 之後那一段——整句拿去比對會被函式名裡的 `public.` 命中，
    // 那是 PB-027 的形狀（數到的是名字，不是被授權的角色）。
    const grantStatement = grants[0] ?? '';
    const grantee = grantStatement.slice(grantStatement.lastIndexOf(' to ') + 4);
    expect(grantee).toContain('service_role');
    expect(grantee).not.toMatch(/\b(anon|authenticated|public)\b/);
  });
});

describe('發放引擎的守門條件', () => {
  it('沒填門檻的滿額活動不得對每一筆預約發獎勵', () => {
    // thresholdAmount 未設定時當成 0，是最貴的一種預設值：一個店家隨手建的空白
    // 滿額活動會對每一筆完成的預約發點數。
    expect(ENGINE).toMatch(/function readThreshold[\s\S]*?n > 0 \? n : null/);
  });

  it('閘門不足時整個活動跳過，不發「發得出來的那一半」', () => {
    // 發一半會吃掉冪等鍵，店家日後補訂閱了那位顧客也拿不到另一半。
    expect(ENGINE).toContain('FEATURE_INACTIVE');
    expect(ENGINE).toContain('continue;');
  });

  it('查詢失敗往上拋，不冒充「沒有活動」（PB-023）', () => {
    expect(ENGINE).toMatch(/查詢 campaigns 失敗[\s\S]{0,120}throw error;/);
  });

  it('票券代碼只有一份實作（batch-issue 與活動獎勵共用）', () => {
    expect(BATCH_ISSUE).toContain("from '@/server/coupon-code'");
    expect(BATCH_ISSUE).not.toContain('CODE_ALPHABET');
    expect(ENGINE).toContain("from './coupon-code'");
  });
});

describe('活動期間判定（isWithinWindow 是純函式，這一組是真的執行證據）', () => {
  const now = new Date('2026-09-08T12:00:00Z');

  it('兩邊都是 null＝立即開始、永久有效', () => {
    expect(isWithinWindow(null, null, now)).toBe(true);
  });

  it('尚未開始不發', () => {
    expect(isWithinWindow('2026-09-09T00:00:00Z', null, now)).toBe(false);
  });

  it('已經結束不發', () => {
    expect(isWithinWindow(null, '2026-09-07T23:59:59Z', now)).toBe(false);
  });

  it('期間內要發', () => {
    expect(isWithinWindow('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', now)).toBe(true);
  });

  it('剛好等於起訖時刻算在期間內（邊界不得把整天的活動吃掉）', () => {
    expect(isWithinWindow('2026-09-08T12:00:00Z', null, now)).toBe(true);
    expect(isWithinWindow(null, '2026-09-08T12:00:00Z', now)).toBe(true);
  });
});
