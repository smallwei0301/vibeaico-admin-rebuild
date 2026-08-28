# 12 — 測試標準與 TDD 工作法（貫穿所有 Phase，強制）

> 本冊是**執行紀律**，不是建議。任何 Phase 的任何任務都必須依 §2 的 TDD 循環
> 進行；一個任務「完成」的唯一定義是 §6 的 Definition of Done 全數成立。
> 測試就是契約的可執行版本 —— **測試紅燈時，先懷疑實作，再查分冊，
> 永遠不准為了過關而改測試**（§2.4）。

---

## 1. 測試基礎設施（Phase 0 一併建立）

### 1.1 工具選型（固定，不得替換）

| 層 | 工具 | 跑什麼 |
|---|---|---|
| 單元測試 | **Vitest** | 純函式、mapper、加解密、zod schema、閘門邏輯（mock Supabase） |
| 整合測試 | **Vitest**（HTTP 打真伺服器） | 每個 API 端點對測試資料庫的真實行為（含 RLS、並發、錯誤碼） |
| E2E 測試 | **Playwright** | 瀏覽器走完整使用者流程（登入、設定、下單…） |

```bash
npm install -D vitest @vitest/coverage-v8 @playwright/test
```

### 1.2 測試資料庫：獨立的 TEST Supabase 專案

另建一個 Supabase 專案專供測試（**絕不能指向正式或 Midao 專案**）。
env 檔 `.env.test`（gitignore 已涵蓋 `.env*`）：

```
TEST_SUPABASE_URL=
TEST_SUPABASE_ANON_KEY=
TEST_SUPABASE_SERVICE_ROLE_KEY=
SETTINGS_ENCRYPTION_KEY=<測試專用一把，64 hex>
AUTH_SECRET=<測試專用>
```

規則：
- 02/09/10/11 各分冊的 migrations 必須同步套進 TEST 專案（新 migration 的
  Definition of Done 包含「TEST 專案已套用」）。
- 對 TEST 專案執行 migration 前，必須取得明確的 TEST 環境授權，並記錄授權者、
  project ref、目前 migration／schema 基線與驗證結果；未完成基線驗證或無授權時，
  禁止執行。若 migration 新增／修改 API 會使用的資料表、欄位或 RPC，套用後必須刷新
  schema cache，並以目標查詢驗證可用。
- **重置腳本 `scripts/test/reset-db.mjs`**（service role）：truncate 全部業務表
  （`auth_verification_codes` 到 `tour_orders`，restart identity cascade）→
  刪除測試 auth users（email 以 `@test.local` 結尾者）→ 執行種子（§1.3）。
  整合測試的 `globalSetup` 先跑它，保證每輪測試從已知狀態開始。
- 安全鎖：reset 腳本開頭檢查 URL 必須等於 `TEST_SUPABASE_URL` 且
  hostname 不等於正式專案，否則直接 `process.exit(1)`。

### 1.3 標準測試種子（所有整合/E2E 測試共用的已知世界）

`scripts/test/seed.mjs` 建立，**id 全部寫死**（測試可直接引用常數）：

| 常數（`tests/fixtures.ts` 匯出） | 內容 |
|---|---|
| `SHOP_A`（tenant-a / owner-a@test.local / 密碼 `Passw0rd!a`） | 店家 A：OWNER 帳號、預設設定、2 服務、2 員工、3 顧客、4 預約（PENDING/CONFIRMED/COMPLETED/CANCELLED 各一） |
| `SHOP_B`（tenant-b / owner-b@test.local） | 店家 B：最小資料 —— 專門用來驗證跨租戶隔離 |
| `STAFF_A2`（staff-a@test.local，role=STAFF） | A 店員工帳號 —— 驗證角色權限 |
| `TRAVELER_1`（traveler-1@test.local） | 旅客帳號（Phase 9 起） |
| `TRIP_A`＋2 方案＋3 團次（其中一團 capacity=2） | A 店行程（Phase 8 起）—— capacity=2 的團次專供並發測試 |

### 1.4 整合測試的伺服器與執行方式

- Vitest `globalSetup`（`tests/integration/global-setup.ts`）：跑 reset-db →
  以 `.env.test` 的變數 + `NEXT_PUBLIC_USE_MOCK=false` spawn `next dev -p 3100`
  → 輪詢 `http://localhost:3100` 就緒 → teardown 時殺掉。

  **teardown 必須殺整個 process group，這裡踩過兩個坑，不要改回去**：
  1. 用 `spawn('npx', ['next', 'dev', …])` 會多一層行程，真正的 `next dev` 是
     **孫行程**；對 npx 送 SIGTERM 殺不到它，它會變孤兒繼續佔著 3100 並抓著
     繼承來的 stdio 管線 → vitest 結束後管線不關閉，**CI job 永久卡住**。
     解法：直接執行 `node_modules/.bin/next`，並用 `detached: true` 讓子行程
     自成 process group，teardown 用 `process.kill(-pid, sig)` 整組終止。
  2. `child.killed` 是「**訊號已送出**」不是「行程已結束」。拿它當結束判斷，
     SIGTERM 之後它就是 true，SIGKILL 升級分支永遠不會執行（死碼）。
     要用自己的 `exit` 事件旗標判斷。
- 測試一律用 `fetch('http://localhost:3100/api/…')` 打 HTTP（不 import route
  模組 —— `cookies()` 等 Next context 只有真伺服器才有）。
- 登入輔助 `tests/helpers/auth.ts`：`loginAs(email, password)` 回傳帶 cookie 的
  fetch wrapper；`travelerJwt(email)` 回 Bearer token。
- 檔名即契約出處：`tests/integration/api/<資源>.<分冊節>.test.ts`
  （例：`bookings.a2.test.ts` = 04 分冊 §A-2）。

### 1.5 指令（加入根 package.json scripts）

```json
"test":              "vitest run tests/unit",
"test:integration":  "vitest run tests/integration --config vitest.integration.config.mts --no-file-parallelism",
"test:e2e":          "playwright test",
"test:all":          "npm run typecheck && npm test && npm run test:integration && npm run test:e2e"
```

整合測試 `--no-file-parallelism`：共用一個資料庫，串行執行避免測試互踩
（唯一例外：並發測試在單一測試檔**內**用 `Promise.all`，見 §5）。
Playwright `webServer` 設定同 §1.4 的啟動方式（`reuseExistingServer: true`）。

**兩份 vitest 設定檔（必須分開，不可合併）**：
`vitest.config.mts`（單元）與 `vitest.integration.config.mts`（整合）。
globalSetup 是設定層級而非檔案層級，會重置 TEST 資料庫並啟動 next dev；單元測試
依 §3 規定不得碰網路/DB，因此唯一乾淨的隔離方式就是各自一份設定檔。
副檔名用 `.mts`：`.ts` 設定會被 Vite 當 CJS 載入並對 ESM 語法發警告（未來主版本
將成為錯誤），`.mts` 明確以 ESM 載入（設定檔內取路徑用 `import.meta.dirname`）。

---

## 2. TDD 工作循環（每個任務都照此執行，不得跳步）

### 2.1 循環

```
① 讀分冊該節 → 抄出 §4 對應的測試案例清單（不自己發明也不刪減）
② 先寫測試 → 跑：必須全部紅燈（測試在實作前就綠 = 測試寫錯，重寫測試）
③ 寫最小實作 → 跑該測試檔 → 綠燈
④ 跑回歸：npm run typecheck && npm test && npm run test:integration
⑤ 全綠才算完成一個任務；紅燈 → 修實作 → 回 ④（可無限重試）
```

### 2.2 連續失敗的處理（防止低階模型在錯誤上打轉）

同一個測試連續 **3 次**修改實作仍紅燈：停止盲改，依序執行 ——
(a) 重新逐字讀分冊對應章節與測試斷言，寫下「測試期望 X、實作回傳 Y」的差異；
(b) 檢查是不是打錯層（例：RLS 擋掉 vs 程式邏輯錯，用 service role 查 DB 實際資料分辨）；
(c) 仍無解 → 在 commit 訊息與 PR 描述記錄 blocker，**不准**跳過或註解掉測試。

### 2.3 測試品質規則

- 每個測試斷言**具體值**，不斷言「有回東西」：狀態碼、`success` 布林、
  `code` 錯誤碼、關鍵欄位值，全部寫死期望。
- 整合測試不 mock 任何東西（資料庫、加密、RLS 全走真的）；單元測試才准 mock。
- 測試資料只用 §1.3 種子常數或測試內自建（自建的要在測試內清理或依賴 reset）。
- 禁用 `sleep` 等待：輪詢條件（間隔 ≤200ms、上限 10s）。

#### 2.3.1 401 的契約判讀

- 遇到 401，先依 canonical API 契約確認該路徑是否預期未登入即拒絕；預期的 401
  不得直接判定為登入（Auth）bug。
- 若該請求理應已登入，才以最小流程驗證：登入 → `/api/auth/me` → 同一受保護端點；
  同時核對 cookie／Bearer、回應錯誤碼與伺服器日誌，區分測試、契約或 Auth 實作問題。

### 2.4 絕對禁止（做了 = 該輪工作無效）

1. 修改/刪除/註解既有測試讓它變綠（唯一例外：分冊本身改了，且 commit 訊息
   引用分冊章節說明契約變更）。
2. `test.skip` / `test.only` / `--passWithNoTests` 進版。
3. 放寬斷言（`toBe(403)` 改 `toBeGreaterThan(0)` 之類）。
4. 在測試裡直接用 service role 幫 API「補做」它該做的事。
5. 未跑 §6 全套就宣稱完成（「應該會過」＝未完成）。

### 2.5 新行為與既有契約的核對

- 新行為不得只新增測試而忽略既有測試契約。實作前必須逐項檢查受影響的既有測試、
  canonical 文件與 API 回應契約。
- 行為確實變更時，先更新 canonical 文件，並在 commit／PR 說明舊契約、新契約及
  所有受影響測試；若契約未變更，既有測試必須保留原斷言。

---

## 3. 三層測試的分工標準

| | 單元 | 整合 | E2E |
|---|---|---|---|
| 測什麼 | 純邏輯：加解密、mapper、遮罩、分頁計算、zod、額度計算 | **每一個 API 端點**：正常流 + 401/403/404/409 + 跨租戶 + RLS + 並發 | 關鍵使用者旅程（§4 每 Phase 列出） |
| 不測什麼 | 不碰網路/DB | 不驗 UI | 不窮舉錯誤分支（整合層已蓋） |
| 最低要求 | `src/server/**` 每個匯出函式至少 1 正例 1 反例；coverage ≥ 80%（`vitest --coverage` 對 `src/server`） | 每端點至少：1 成功、1 未登入 401、1 跨租戶 404/403、每個分冊列出的錯誤碼各 1 | 每 Phase 的旅程清單全綠 |

**每個 API 端點的整合測試通用骨架**（低階模型照抄改參數）：

```ts
describe('POST /api/bookings/:id/confirm (04 §A-2)', () => {
  beforeEach(resetDb);
  it('PENDING → CONFIRMED，回 {success:true}', async () => {
    // fixtures 的 owner 是 { email, password } 物件；loginAs 簽名見 §1.4
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post(`/api/bookings/${SHOP_A.bookingPending}/confirm`);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(await dbStatus('bookings', SHOP_A.bookingPending)).toBe('CONFIRMED');
  });
  it('未登入 → 401 AUTH_001', async () => { /* fetch 不帶 cookie，斷言 code */ });
  it('B 店帳號帶 A 店 id → 404 REQ_002', async () => { /* loginAs(SHOP_B) */ });
  it('已 CONFIRMED 再 confirm → 409 REQ_003', async () => { /* 狀態機 */ });
});
```

---

## 4. 每 Phase 必寫測試矩陣（任務清單的一部分，不是選配）

檔名固定如列；「案例」欄是**最少集合**，各分冊驗收清單裡的項目都必須有對應測試。

### Phase 0–1（基礎/Schema）
| 檔 | 案例 |
|---|---|
| `tests/unit/crypto.test.ts` | encrypt→decrypt 還原；空字串；壞密文丟錯；不同 iv 產不同密文 |
| `tests/unit/paging.test.ts` | pageRange 邊界（page 0、size 上限）；toPaged 總頁數 |
| `tests/unit/mappers.test.ts` | 每個 mapper：snake→camel 全欄位、null 規則（gender null→''） |
| `tests/integration/db/rls.test.ts` | anon 未登入查 customers 回空；A 帳號查不到 B 店資料（逐張核心表） |
| `tests/integration/db/booking-overlap.test.ts` | 同員工重疊插入被 `23P01` 擋；不同員工/CANCELLED 不擋 |

### Phase 2（登入）
| 檔 | 案例 |
|---|---|
| `tests/integration/api/auth.03.test.ts` | 寄碼→註冊→登入→me 全流程；60 秒重寄 429；錯碼/過期碼 AUTH_004；重複 email AUTH_003；shopCode 重複 AUTH_006；錯密碼 AUTH_002；忘記→重設→新密碼可登入；改密碼需驗舊密碼；register 失敗補償（店建立失敗時 auth user 被回滾） |
| `tests/integration/api/tenancy.03.test.ts` | my-tenants current 正確；switch-tenant 後 me 變更；非成員 switch 403 |
| `tests/e2e/auth.spec.ts` | 未登入進 dashboard 被導去 login；登入成功進 dashboard；登出後再訪被擋 |

### Phase 3（核心 API）— 每端點照 §3 骨架，另加：
| 重點案例 |
|---|
| settings：secret 存後回讀是遮罩；送空字串不覆蓋、送新值有覆蓋（用 service role 直查 `*_enc` 驗證）；shopCode 改重複 409 |
| bookings 列表：狀態/關鍵字/員工/日期四種篩選、分頁 totalElements 正確 |
| complete 累點：pointEarnEnabled + rate 換算 + rounding 三模式各一例；關閉時不加點 |
| customers：atRisk/minSpent 篩選走 view；刪除有進行中預約 409（軟刪 active=false） |
| reports/dashboard：以種子資料手算期望值寫死斷言 |

### Phase 4（寄信）
單元：模板 HTML escape（name 含 `<script>` 不得原樣輸出）；開關對應表逐鍵。
整合：RESEND_API_KEY 空時 API 仍 200。（不真寄信 —— send 函式單元層 mock resend）

### Phase 5 / 5.5（進階 + 功能商店）
| 檔 | 案例 |
|---|---|
| `tests/integration/api/feature-store.09.test.ts` | 餘額足訂閱：CONSUME 交易、到期日 +N 月；不足 409 POINTS_001 **且餘額未被扣**；續訂從原到期日累加；取消後到期前 isFeatureActive 仍 true；restore 不扣點；LITE 只扣一次 399×N 且 5 碼全開；LITE→PRO 升級 |
| `tests/integration/api/gating.09.test.ts` | 閘門對應表逐條：未訂閱打對應端點 403 FEAT_001；第 4 位員工被擋；第 21 組關鍵字被擋；EXTRA_PUSH 額度 200↔700 |
| `tests/integration/api/feature-expiry.09.test.ts` | 到期 cron：票券→PAUSED+旗標、商品下架；restore 還原並回報筆數 |
| 其餘 B 組端點 | 照 §3 骨架，含各狀態機 409 |

### Phase 6（LINE）— 不打真 LINE API
- 單元：webhook 簽章驗證（正確/錯誤/缺 header）；事件分派決策（keyword 命中優先序 ①→⑤）。
- 整合：`line.ts` 的 fetch 以環境變數 `LINE_API_BASE` 指向測試內建的 mock
  server（`tests/helpers/line-mock.ts` 用 node http 起本地假 LINE，記錄收到的請求）；
  驗 webhook POST（含正確簽章）→ line_users upsert、chat_messages 寫入、
  reply 被打到 mock；壞簽章 401；處理中丟錯仍回 200；quota 用完不推播。
- **雙向收發鏈路**（04 §B-5.1）：webhook 收到訊息 → `GET /api/chat/messages?after=`
  拉得到該筆；`POST /api/chat/messages` → mock LINE 收到 push、DB 有 OUT 訊息、
  推播額度 -1；額度用完時該端點回 409 且**不呼叫** LINE API。
- **AI 客服上下文**（09 §7.2）：組出的 system prompt 必須同時含服務與行程
  （斜槓租戶）、含未來 14 天團次與正確剩餘名額；團次售完後重新組 context
  該筆不應再出現。AI 呼叫本身在單元層 mock（不打真 API），只驗 prompt 內容
  與逾時/失敗時回 null 落回 defaultReply。

### Phase 7（Cron）
- 每個 cron：無 Bearer 401；正例（用 service role 預置符合條件的資料 → 打 cron →
  驗結果）；防重發（reminder_sent_at / last_recall_at）；每日 50 上限。

### Phase 8（行程）
| 檔 | 案例 |
|---|---|
| `tests/integration/api/tours.10.test.ts` | trips/plans/departures CRUD；capacity 調低於已售 409；ARCHIVED 規則 |
| `tests/integration/api/tour-orders.10.test.ts` | 下單佔位、餘額即時正確；**並發測試（§5）**；取消釋放；hold 過期 cron 釋放；匯款後五碼→確認收款→CONFIRMED |
| `tests/integration/api/ecpay.10.test.ts` | CheckMacValue 產生/驗證（單元）；callback 正確 mac → PAID + 回 `1|OK`；**同編號重送冪等**；壞 mac 拒絕 |
| `tests/e2e/tour-admin.spec.ts` | 後台建行程→建團次→看到訂單 |
| `tests/integration/api/calendar.10.test.ts` | 統一 `/api/calendar`：同區間同時回 BOOKING 與 DEPARTURE 事件；非 TOUR_MODULE 租戶不含 DEPARTURE；ICS feed 含團次 VEVENT 與取消團的 STATUS:CANCELLED；**開團後 available-slots 排除該時段**（§5.5 撞班防護） |

### Phase 9–10（旅客/公開 API/Partner）
- 公開 API：未登入可讀行程、餘額；checkout 未帶 JWT 401；旅客只能看自己訂單；
  評論限 COMPLETED、一單一評；**白名單欄位測試**（回應 JSON 不含 `*_enc`、成本欄位）。
- 自動建檔：同 phone 重下單不重複建檔；traveler_user_id 回填。
- Partner：HMAC 錯簽 401 PARTNER_001；代建行程後導遊帳號查得到；webhook 事件送達
  （mock 接收端）。CORS：白名單 origin 有 ACAO header、其他沒有。
- Midao 上架審核流：request-midao-listing NONE→PENDING（重複申請 409）；
  listing-decision LISTED 後出現在 partner 前台過濾條件、REJECTED 帶 note
  導遊端可讀；`midao_listing='LISTED'` 但 `status='DRAFT'` 不得出現在 Midao 前台清單。
- `tests/e2e/traveler.spec.ts`：商店頁瀏覽→登入→下單（匯款）→我的訂單→（種子改
  COMPLETED）→留評論。

---

## 5. 指定樣板：並發不超賣測試（Phase 8 的靈魂，逐字級照抄再改常數）

```ts
it('兩個並發 checkout 搶最後名額，恰好一成一敗（10 分冊 §2）', async () => {
  await resetDb();                              // TRIP_A.departureCap2：capacity=2
  const t1 = await travelerJwt(TRAVELER_1.email);
  const body = (n: number) => JSON.stringify({
    departureId: TRIP_A.departureCap2, partySize: n,
    paymentMethodId: SHOP_A.pmBankTransfer, contact: { name: '測試', phone: '0912345678' },
  });
  const post = () => fetch('http://localhost:3100/api/public/checkout', {
    method: 'POST', headers: { Authorization: `Bearer ${t1}`, 'Content-Type': 'application/json' },
    body: body(2),                              // 各要 2 席，只夠一單
  });
  const [r1, r2] = await Promise.all([post(), post()]);
  const codes = [r1.status, r2.status].sort();
  expect(codes).toEqual([200, 409]);            // 恰好一成一敗，不能兩敗也不能兩成
  const fail = r1.status === 409 ? r1 : r2;
  expect((await fail.json()).code).toBe('TOUR_001');
  expect(await dbSeats(TRIP_A.departureCap2)).toBe(2);   // seats_booked 恰為 2
});
```

---

## 6. Definition of Done（每個任務收尾自檢，缺一不可）

1. 本任務在 §4 矩陣中列名的測試檔存在且**先紅後綠**。
2. `npm run typecheck` 零錯誤。
3. `npm test`（全部單元）綠。
4. `npm run test:integration` 綠（本 Phase 及**之前所有 Phase** 的整合測試）。
5. 該 Phase 有 E2E 項目時 `npm run test:e2e` 綠。
6. `NEXT_PUBLIC_USE_MOCK=true` 且其餘 env 全空時 `npm run build` 成功（鐵則 10 回歸）。
7. 新 migration 已套用到 TEST 專案且 reset/seed 腳本同步更新。
8. commit 訊息含：對應分冊章節 + 執行過的測試指令與結果摘要。

---

## 7. CI（`.github/workflows/ci.yml`，Phase 0 建立）

```yaml
name: ci
# workflow_dispatch：允許不必等 push/PR 就手動觸發一次 run（例如補完 repo secrets
# 後想立刻確認 integration job 是否轉綠，但沒有「rerun 既有 run」的權限時）。
on: { push: { branches: [main] }, pull_request: {}, workflow_dispatch: {} }
jobs:
  check:                       # 無秘密即可跑：擋最常見的壞 commit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build      # env 全空 + mock 模式（鐵則 10 的 CI 版）
        env: { NEXT_PUBLIC_USE_MOCK: 'true' }
  integration:
    runs-on: ubuntu-latest
    if: ${{ github.event_name == 'pull_request' || github.ref == 'refs/heads/main' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:integration
        env:
          TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          TEST_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          TEST_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          SETTINGS_ENCRYPTION_KEY: ${{ secrets.TEST_SETTINGS_ENCRYPTION_KEY }}
          AUTH_SECRET: ${{ secrets.TEST_AUTH_SECRET }}
      # e2e 與 integration 共用同一組 TEST secrets。GitHub Actions 的 env 不會跨
      # step 繼承，這裡必須逐條展開；留空（`env: { }`）會讓 e2e 拿不到任何憑證。
      - run: npx playwright install --with-deps chromium && npm run test:e2e
        env:
          TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          TEST_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          TEST_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          SETTINGS_ENCRYPTION_KEY: ${{ secrets.TEST_SETTINGS_ENCRYPTION_KEY }}
          AUTH_SECRET: ${{ secrets.TEST_AUTH_SECRET }}
```

規則：**紅燈不得 merge**；三個 TEST secrets 由 owner 填進 GitHub repo secrets
（Settings → Secrets and variables → Actions）。

---

## 本冊驗收（Phase 0 結束時）

- [ ] vitest / playwright 安裝；`tests/` 目錄骨架 + fixtures.ts + helpers 建立
- [ ] TEST Supabase 專案建立；reset-db 安全鎖生效（指向非 TEST URL 時退出）
- [ ] `npm run test:integration` 可從零跑起（globalSetup 起 server、跑完清掉）
- [ ] CI 兩個 job 上線且 main 綠燈
- [ ] 故意寫一個必敗測試 → CI 紅 → 修好 → 綠（驗證關卡真的會擋）
