# 15 — 執行者手冊（每個 issue 開工前必讀，低階模型逐字照做）

> 修復-1〜6（issue #3–#8）與建置系列（#9 起）的每一個 issue 都引用本冊。
> 這裡是**共通紀律與環境操作要點**；各 issue 只寫該任務特有的內容。
> 你（執行者）遇到本冊與分冊衝突 → 分冊為準；遇到規格內部衝突 → **停下，
> 在該 issue 留言說明並附證據，等待決策，不准自行選一邊做下去。**

---

## 名詞：誰是「擁有者」、誰是「主導者」

分冊裡這兩個詞指不同的人，**效力也不同**。看到任何一個詞時先確認是哪一個：

| 詞 | 是誰 | 效力 |
|---|---|---|
| **擁有者** | 這個專案的人類擁有者 | **裁決**。記在 `14-GAP-AUDIT.md` §8，執行時照做，不要重新思考、不要自行變通 |
| **主導者** | 派工給你的那個 Claude（orchestrator） | **複核**。讀過你的推導並認為成立，是工程判斷；日後有更好的理由可以推翻 |
| **執行者** | 你 | 依 issue 施工並提出證據 |

所以：

- 「**擁有者已裁決**」＝ 不要動它，照做。
- 「**主導者複核通過**」＝ 有人看過、目前成立，但**不是**擁有者點過頭。
  你若發現更好的理由，提出來是對的。
- 「**待擁有者裁決**」＝ 還沒有人拍板，**不准猜**，寫進報告問。

⚠️ 這三種狀態不可互相冒充。把「執行者自己推導出來的」寫成「擁有者已認可」，
就是本專案反覆在清的那種假的已知——日後的稽核者讀到「已認可」就不會再開這個案子。
**看到不對就指出來，即使指出的是主導者寫的東西。**（2026-08-25 就發生過一次：
一位執行者正確地質疑了主導者寫在 14 分冊 §6.6 的一行措辭，該行因此改寫。
那次是措辭歧義而非造假——但質疑本身是對的，因為當時這一節還不存在，
「主導者」這個詞在整本手冊裡從未被定義過。）


## 派工要選模型（給主導者看的）

擁有者 2026-08-25 裁決：**混用**。派工時在 `Agent` 呼叫裡明確帶 `model`，
**不要留空**——留空會繼承主導者當下的模型，而 session 的模型可能被切換過，
等於讓「這件事該用哪個模型」變成一件碰運氣的事。

| 工作性質 | 模型 | 判準 |
|---|---|---|
| 純接線、照抄同檔案／隔壁頁既有形狀、文案替換、寫重複結構的測試、機械性批次修改 | **Sonnet** | 「正確答案已經寫在別的地方，這一輪是把它複製到對的位置」 |
| 安全邊界、收費邊界、**測試前提變更**、外部規格查證、稽核、任何要判斷「這算不算假成功」的事 | **Opus** | 「做錯了不會有紅燈告訴我們」 |

⚠️ **分界不是看工作量，是看「做錯時會不會被測試抓到」。**
一個 300 行的機械替換用 Sonnet 沒問題；一個 5 行的閘門判斷要用 Opus，
因為閘門放寬了測試照樣綠。

⚠️ **測試前提變更一律 Opus。** 這是本專案最危險的動作——
「把斷言放寬讓它繼續綠」和「前提真的變了所以重新釘」外表一模一樣，
分辨它們需要理解那條斷言當初在防什麼。這條沒有折扣。

（2026-08-25 之前主導者一直沒帶 `model`，於是 16 個 agent 全繼承成 Opus，
與擁有者原本「低階模型施工」的指示不符。記在這裡避免重犯。）


## 實測腳本的兩條慣例

**截圖與下載檔一律寫進 `scripts/verify/out/`。** 那個目錄被 gitignore 涵蓋，
放別的地方會混進版本庫，而截圖進了 repo 之後很難清。
（2026-08-25 有一支腳本寫成 `scripts/verify/.out-xxx.png`，`.out-` 前綴、直接放在
`verify/` 底下，躲過了 `out/` 那條規則。`.gitignore` 已補檔名樣式當安全網，
但正確做法還是寫進 `out/`。）

**不要在整合測試跑的同時另起第二個 `next dev`。** 兩個 dev server 共用同一份
`.next` 開發建置快取，會把 vendor chunk 寫壞——症狀是整批測試冒出
`Cannot find module './vendor-chunks/@supabase.js'`、所有登入回 500，
看起來像程式壞了，其實是快取被踩爛。若非起不可（例如要測的改動還沒 push、
Preview 上沒有），**腳本收尾要 `rm -rf .next`**，並在檔頭寫明這個坑。

## 跑整合測試前：先確認別人沒在改你會用到的東西

`flock /tmp/vibeaico-integration.lock` **只序列化「跑測試」，不序列化「改原始碼」**。
這是 2026-08-25 一位執行者實測發現的：他跑全量整合測試的那 11 分鐘裡，另外兩位
agent 正在改 `src/app/api/**` 與 `src/server/**`，共用的 `next dev` 熱重載讀到
**半寫入的模組**，於是 291 個案例裡 100 個變成 `expected 500 to be 200`。

那份紅燈**與他的改動完全無關**，但如果他當成自己的問題去追，會浪費很久；
如果他當成「別人的問題」直接無視，又可能漏掉真的紅燈。

**所以跑全量 `npm run test:integration` 之前，先看一眼：**

```bash
git status --short -- src/app/api src/server src/config src/lib
```

- **乾淨** → 全量跑，結果可信。
- **有別人未提交的變更** → **不要跑全量**。改成只跑你自己的測試檔：
  ```bash
  flock /tmp/vibeaico-integration.lock npx vitest run \
    tests/integration/api/你的檔案.test.ts --config vitest.integration.config.mts --no-file-parallelism
  ```
  逐檔跑不受熱重載影響，證據一樣有效。**在報告裡寫明你跑的是逐檔而非全量，以及為什麼**
  ——這不是打折，是選了在當下條件下唯一可信的做法。

⚠️ **不要把「別人在改東西」當成忽略紅燈的萬用理由。** 要無視某個紅燈，必須拿出反證，
例如：同一支測試在你一行未改的情況下重跑就綠、或 `grep` 證明你改的檔案結構上到不了
那條路徑。**「應該無關」不是證據。**


## 1. 開工流程（每個 issue 一律照此順序）

1. 讀完該 issue 全文 → 讀 issue 點名的每一個分冊章節 → 讀本冊。
2. 把 issue 的驗收清單**原樣**複製到你的工作 todo，不准刪項、不准改寫措辭。
3. 照 12 分冊 TDD：先寫測試（紅）→ 最小實作（綠）→ 全量回歸。
4. 每完成一個驗收項，**當下**在 issue 留言或 PR checklist 打勾並附證據
   （格式見 §2）。全部打勾後才可宣告完成；宣告完成的留言必須含
   typecheck / build / test / test:integration 四條指令的輸出尾段。
5. 下一個 issue 在前一個全數打勾前**不得開工**（連「先看看」的探索性修改都不行）。

## 2. 證據格式（08 分冊打勾規則的操作版）

- 自動化測試：`tests/integration/api/xxx.test.ts:「案例名稱」`（檔案要真的存在、
  案例要真的綠；引用不存在的測試 = 假的已知，該輪工作無效）。
- 自動化實測：腳本路徑 + 執行輸出的關鍵行（貼原文，不准改寫或摘要成「成功」二字）。
- 靜態鏈路證據（DoD 10 最低標準）：`頁面檔:行號 handler → services 函式 → 端點路徑`
  三段逐一列出，並註明該端點的整合測試檔。
- **禁止**的證據形式：「已確認」「應該可以」「邏輯上正確」——沒有輸出的主張不是證據。

## 3. 絕對禁令（違反任何一條 = 該輪工作無效，重做）

1. 不准為了讓測試過而改測試（12 §2.4 全清單）。
2. 不准顯示成功訊息但副作用沒發生（00 鐵則 12）。做不到就顯示「尚未生效」。
3. 不准跳過驗收項、合併驗收項、或「先做後面的再回頭補」。
4. 不准自行發明規格。分冊沒寫的行為 → issue 留言問，等回覆。
5. 不准把 secrets 寫進任何會 commit 的檔案、issue、PR 內文（含測試 fixture）。
6. 不准對正式 Supabase 專案跑 reset/清庫類腳本（reset-db 有安全鎖，但不要測試它）。
7. migration 編號一律取 `supabase/migrations/` 現有最大號 +1；**分冊裡寫死的編號
   （0012/0013…）是撰寫當時的假設，已過時，不要照抄**。

## 4. 憑證與環境（自主撈取，不留人工步驟）

- **憑證來源**：Google Drive 文件「#Supabase#midao」（用 Google Drive 工具搜尋
  該標題、讀取內容）。內含：Supabase Management API token（sbp_…）、兩個
  Supabase 專案 ref 與 keys、Midao LINE Channel ID/Secret/長期 token、Vercel
  token、Resend key。**缺哪個 token 就在 issue 留言列名請擁有者補**，不要繞路。
- **測試帳號**：`sulawei0301@gmail.com` / `@Wei3362499`（Preview 站）。密碼對不上時
  走「忘記密碼」流程：`POST /api/auth/forgot-password` → 用 Management API 查
  `auth_verification_codes` 表取 code → `POST /api/auth/reset-password` 設回
  `@Wei3362499`。**永遠設回這組**，擁有者只記這一組。
- **兩個 Supabase 專案**：正式 `egehnijjpgijmccagxac`（Vercel production+preview 用）、
  TEST `nmwhwngojosmagjuvxol`（整合測試/CI 用）。migration 兩邊都套、套完各自
  query `information_schema` 驗證（CLAUDE.md 有 Management API 範例；`psql` 在
  sandbox 連不上，一律走 Management API + `NODE_USE_ENV_PROXY=1`）。
- **Preview 站**：`https://vibeaico-admin-rebuild-git-claude-70df20-smallwei0301s-projects.vercel.app`
  （branch alias，push 後自動部署；打 API 前先確認最新 deployment READY）。

## 5. Playwright 實測要點（sandbox 專屬，不照做會連不上）

```js
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  proxy: { server: process.env.HTTPS_PROXY },   // 埠號每次 session 不同，必須讀環境變數
  args: [
    '--no-sandbox',
    // 出口 proxy 的攔截 CA（三組 SPKI，缺一可能握手失敗）
    '--ignore-certificate-errors-spki-list=gBdItbWylHhTkoJDRwIiMuweY/qX4F0bJmLNs5wosUQ=,KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk=,PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0=',
    '--ssl-version-max=tls1.2', // proxy 不支援 Chromium 的 TLS1.3 ClientHello，必加
  ],
});
```

- 腳本副檔名用 `.cjs`（CLAUDE.md 的全域 Playwright 要 `require()` 絕對路徑，
  `.mjs` 會炸 `require is not defined`）。
- 登入頁欄位 id：`#username` / `#password`（不是 #email）。
- LINE 設定頁的 secret 欄位是遮罩唯讀，要先點「重新輸入」才可 fill。
- Node 直接 fetch 外網要 `NODE_USE_ENV_PROXY=1`。

## 6. 真實 LINE 驗證要點

- Midao 頻道（憑證見 Drive 文件）**可以自由測**（擁有者已確認未營運）。
  測完把狀態還原：webhook 指回 Preview、測試用 rich menu/keyword 清掉。
- Flex/訊息 JSON 用 `POST /v2/bot/message/validate/reply|push` 驗格式——
  **不耗推播額度**。真發訊息會耗每月 200 則額度，非必要別發。
- 「自動回應」判定用 `GET /v2/bot/info` 的 `chatMode`（bot=關、chat=開）；
  chatMode 由「回應功能→聊天」總開關決定，**無寫入 API**，不要嘗試自動改。

## 7. 出貨與追蹤

- 分支：`claude/deploy-vercel-project-nnno59`；commit 訊息繁中、描述使用者可見
  變化；**Vercel 從 main 自動部署正式站**，只有擁有者說要上正式才碰 main。
- 每個 issue 完成＝一次（或少數幾次）commit + push + issue 留言貼證據 +
  更新 14 分冊勾選與 08 分冊對應項。
- 卡住超過 3 次同一個錯（12 §2.2）：停，把嘗試過的方案與錯誤原文留言到 issue。
