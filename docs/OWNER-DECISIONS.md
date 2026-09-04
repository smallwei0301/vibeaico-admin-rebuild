# Owner Decisions — current index

> 本檔是跨領域 Owner 決策索引，讓 Agent 在開工前快速知道哪些題目已經裁示，避免重複詢問。
> 正式領域規格仍以各 `docs/integration/**` canonical 文件為準；Issue 負責施工範圍與驗收。
> 最後更新：2026-09-04。

## 2026-09-04 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| repo governance | 復原而非取消 | **取向為將目前無效的功能復原為真的可用，而不是直接取消功能。** | 發現假成功時預設把它接成真的，不是移除按鈕或欄位。確實無法實作時（後端缺欄位、缺商業決策）採「誠實復原」：保留 UI 流程、改呼叫真實端點、把後端真實訊息原樣顯示，並把缺口升級為 Owner 待決；**不得捏造前端資料，也不得默默移除 UI**。canonical：`docs/DELIVERY-CHAIN.md` §5。 |
| repo governance | 產品交付鏈路固化 | **Luna 查證歸屬 → Terra 獨立 worktree 施工 → Sol 實際讀 diff audit → 本機隔離 Supabase → 序列化 canonical TEST → Completion Truth 五項驗證，是本 repo 的正式產品交付鏈路。** | 每一關有明確要抓的東西：重複／owner-blocked、lane 互相污染、CI 抓不到的假成功、migration 對空白資料庫的正確性、搶用共用資源與 `POLICY_SKIP` 假綠、把 REQUESTED 當成 COMPLETED。任一關可判定「不適用」並寫明理由，**不得判定「略過」**。canonical：`docs/DELIVERY-CHAIN.md`。 |

## 2026-09-03 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #120 / #48 | GUIDE SaaS 正式價格骨架 | **永久體驗版 NT$0，1 位導遊、累積 30 張有效訂單；個人版 NT$399／月，1 位導遊；團隊版 NT$799／月，含 5 位 active+bookable 導遊。** | 第 30 張免費有效訂單可成立，第 31 張起要求升級；既有訂單／退款／通知／資料仍可處理。團隊 5 席包含 owner；停用與歷史人員不占新席次。超過 5 位、年繳折扣、AI／LINE 加購及 Production subscription billing 仍待後續裁示。canonical：`docs/decisions/2026-09-03-guide-saas-pricing.md`。 |

## 2026-09-02 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #41 / #12 / #42 / #46 | GUIDE 旅客取消／退款建議模板 | **每個導遊、每個 Trip Plan 可自行設定取消／退款政策；Midao 提供非強制建議模板。建議模板採三段式、實際不可退成本基準、訂金視為已付款、實際且不退的金流費可納入試算，並預設提供透明明細與可選證據附件。** | 2026-09-02 SaaS 上位裁示覆蓋較早「必須」措辭中的商業政策部分；導遊可自訂。平台強制底線只保留成交 policy/price snapshot、真實 payment/refund state、不重複／負數金額、provider 費用不可捏造與 tenant/order 權限隔離。canonical：`docs/decisions/2026-08-31-guide-cancellation-policy-config.md`。 |
| #41 / #12 / #42 / #46 | 已成團後價格保護 | **已成團後若個別旅客取消、團次跌破最低成團門檻而進 `AT_RISK`，導遊若選擇照常出團，剩餘旅客維持各自成交價格，不補差額、不因剩餘人數重新計價。** | `AT_RISK → CONTINUE` 不得增加既有 TourOrder 的 `total_amount`／`balance_due`，也不得建立人數不足補差額應收；若成本無法承擔，導遊應選擇取消整團。canonical：`docs/decisions/2026-09-02-guide-formed-price-protection.md`。 |
| #41 / #12 / #42 / #43 / #46 / #48 | GUIDE SaaS 平台角色與爭議預設 | **Midao GUIDE 主要營收方向是 SaaS 後台費用＋Midao 前台曝光／上架；平台提供取消退款工具、紀錄與非強制建議預設，但一般導遊／旅客爭議由雙方自行處理，Midao 不作主要仲裁者。導遊／業者主動取消整團的建議預設為旅客全額退款。** | 一般退款比例、未成團、不可抗力、no-show、部分取消、善意退款等不再逐題當 Owner blocker；採合理 default + guide override。退款失敗進導遊 Action Inbox，不建立 Midao 管理員中央審批。canonical：`docs/decisions/2026-09-02-guide-saas-platform-role-and-dispute-defaults.md`、`18-GUIDE-COMMERCE-LIFECYCLE.md` §9。 |
| #118 / #48 | GUIDE SaaS＋前台曝光營收模型 | **主要營收拆成 GUIDE SaaS 訂閱與 Midao 前台曝光／推廣；`midao_listing` 只代表自然上架資格，付費曝光使用獨立 promotion/campaign 模型。自然結果與贊助版位分離，贊助需清楚標示；目前不預設每筆 TourOrder 抽成。** | MVP 先驗證固定期間／固定版位，不先做 CPC／CPM／競價平台。SaaS、自然上架、付費曝光、平台代建分開呈現；正式月費、曝光價格與 Production 扣款仍需 Owner 拍板。canonical decision：`docs/decisions/2026-09-02-guide-saas-exposure-revenue-model.md`。施工 Issue #118。 |
| #120 / #48 | GUIDE SaaS 方案權益 | **GUIDE 以免費／試用、個人、團隊 SaaS 方案權益為主，不把 legacy Feature Store 的 22 張單項功能卡當主要商業體驗；個人 SaaS 的正常日常能力不再為基本報表、GUIDE availability、交易通知逐項二次收費。** | 團隊差異以 active+bookable guide seats 為主。真正 add-on 留給額外 LINE Push、AI 用量、#118 Midao 曝光、平台代建等外部成本／額外價值。LOCAL_SHOP／CLINIC legacy Feature Store 保持相容。正式價格、舊點數轉換與 Production subscription billing 仍需 Owner 拍板。canonical：`docs/decisions/2026-09-02-guide-saas-entitlement-model.md`。施工 Issue #120。 |

## 2026-09-01 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| repo governance | B+ 出貨迴圈 | **B+ 正式取代 Mode C 中「不同 Issue 可同時有多條完整 Terra BUILD」的排程。全 repo 保留 1 條 MAIN Terra 完整出貨線、最多 1 條 source-only RESERVE Terra、1 條 Luna Closure、預設 4／最多 6 個窄任務 Luna、1 條 shared TEST，以及最多 2 張 active candidate PR。** | MAIN 未到 `CLOSED`／`AUDIT_READY`／完整 `OWNER_BLOCKED` 前，不開第二條完整大型工地。RESERVE 不碰 TEST、不進 Audit、最多一個原子 commit。Sol 一般只做 TRIAGE 與 AUDIT。canonical：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`、`docs/AGENT-EXECUTION.md`、`docs/AGENT-BPLUS-DELIVERY-LOOP.md`。 |
| repo governance | 自然語言 Loop 指令 | **「開始 Loop」「繼續 Loop」「復盤」「複盤」是本 repo 的正式自然語言入口。`/goal` 與開始／繼續 Loop 相容；復盤預設唯讀，復盤並優化最多實作兩項治理改良。** | 有 `IN_PROGRESS` Run 時接續，不另建重複 Run。新 Session 從 `origin/main` 的 `AGENTS.md`、orchestration Skill 與 retrospective Skill 重建指令語意。canonical：`docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`。 |
| repo governance | Completion Truth Gate | **送出 merge／close／migration／deploy 等寫入動作不等於完成。宣稱完成前必須重新讀 live PR／Issue／CI／main／環境並留下可追溯證據。** | PR 合併至少驗證 `merged_at`、`merge_commit_sha`、current main head、可追溯 compare 與 `ref=main` 關鍵檔案。尚未查證只能寫 `*_REQUESTED_UNVERIFIED`。未查證卻宣稱完成，復盤記 `AUDIT_DATA_INVALID`、安全性失敗與 `F-HARD`。canonical decision：`docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`。 |

## 2026-08-31 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| repo governance | 全域 WIP 與 Close-first 基礎 | **全 repo 單一完整 Terra、固定 Closure、單一 shared TEST、最多兩張 active candidate 與 close-first TRIAGE 是 B+ 的基礎；2026-09-01 起另允許一條嚴格 source-only RESERVE Terra。** | 以 2026-09-01 B+ 為最新裁示。其餘 PR 必須 `PARKED`／`HISTORICAL`／`OWNER_BLOCKED`；不得引用 Mode C 恢復多條完整 Terra。 |
| repo governance | Owner 控制訊號與 Issue 來源 | **Owner 重送 `/goal`、`/steer` 或「繼續」可能是模型速度／深度／角色切換，不能單憑此記為 Agent 提早停止；只有具完整 `AGENT_DISCOVERED` 來源的 Issue 才算 Agent 新增。** | 模型切換保留 branch／PR／exact head／TEST lane／Run ID，不重做完成工作；缺少前一位 assistant 終止性證據時寫 `UNKNOWN_CONTROL_EVENT`；歷史無來源 Issue 一律 `owner-or-unknown`。 |
| repo governance | 遠端 tree、套件與語法完整性 | Git Data API 建出的 exact head 必須依序通過完整性閘門、`npm ci`、typecheck、unit 與 build，才可建立或移動 `preview/**`。 | 核心路徑缺失、異常大量刪檔、程式檔裸 SHA、lockfile 無法重建或編譯失敗一律 fail closed；見 `docs/decisions/2026-09-02-owner-repository-integrity-gates.md`。 |
| repo governance | PR lifecycle Janitor | **保留 fail-closed stale PR 清理、每 Issue 單一 ACTIVE candidate 與短命 VALIDATION；Janitor 必須服從 B+ 的 MAIN／RESERVE／Closure／TEST 與兩候選上限。** | 只有明確 metadata、同 Issue、同 repo、祖先或 patch coverage、mutation 前狀態未變時才自動關閉 superseded PR，否則 `JANITOR_REVIEW`。canonical：`docs/PR-LIFECYCLE.md`。 |
| #66 / GUIDE | GUIDE 新響應式 UI | **以五張手機基準稿為正式視覺與資訊架構基準；第一層固定為首頁／團次／旅客／訊息／更多。** | 手機大字、大卡片、低資訊密度；平板／桌機仍維持同五個父層級；GUIDE 行事曆以月／週／日期團次摘要為主，不做美業式小時時段牆。canonical：`20-GUIDE-RESPONSIVE-UI.md`。 |
| #41 / #12 / #42 | GUIDE 尾款期限 | **預設成團後 48 小時，但導遊可自行修改；常見現場收費方式必須是一級快速選項。** | 快速選項至少含 24h／48h／72h／現場收尾款／自訂；NONE 可顯示現場收全額。現場收款不提前標記尾款逾期，實收後由導遊確認。 |
| #41 / #12 | 尾款逾期 | **到期未付不自動取消、不自動釋放名額、不自動沒收訂金；先通知導遊與旅客，由導遊決定延長或取消。** | 預設快速選項為「到期未付 → 通知我處理」；現場收尾款／全額的方案在出發前不走一般尾款逾期。canonical decision：`docs/decisions/2026-08-31-guide-balance-payment-deadline.md`。 |
| #41 / #12 / #42 / #46 | 旅客取消／退款規則 | **每個導遊、每個 Trip Plan 可自行設定；Midao 提供建議範本。** | 較新的 2026-09-02 SaaS 平台角色裁示取代任何把細節誤讀為不可修改平台退款條款的舊說法；見最新 2026-09-02 區段。canonical：`docs/decisions/2026-08-31-guide-cancellation-policy-config.md`。 |

## 2026-08-28 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| repo governance | Agent 常駐自主執行 | **長程任務預設持續推進到所有可施工項目完成；階段性回報後不得停工，也不得重問已記錄的授權／裁示。** | 依 B+ 盤點、派工、序列化 TEST、保存證據；驗收與最終分支成立後可自主關閉 Issue，只剩真正 Owner／Production 阻塞才結束。 |
| repo governance | 角色式模型派工 | **工作角色優先於目前對話模型；Luna 做盤點／CI／Closure／文件／Metrics，Sol 做 TRIAGE／模糊高風險判案／Audit，MAIN Terra 做唯一完整施工，RESERVE Terra 只做一個 source-only 小切片。** | 一般 Issue 的 Sol 目標為 TRIAGE 一次、AUDIT 一次。只有 Sol 回覆 `CLOSE_APPROVED` 才可關 Issue。`.agents/skills/vibeaico-agent-orchestration/SKILL.md` 是執行轉接器，正式規則以 Owner Decision 與 `docs/AGENT-EXECUTION.md` 為準。 |
| repo governance | 憑證取得 | **可從已連結 Google Drive `midao.md`／`midao.env` 取得本專案必要憑證，Owner 不負責 seed、登入、cookie 或 API 排錯。** | 秘密不可輸出、提交或轉交 Agent；真的缺權限才列 Owner 待辦，並繼續其他工作。 |
| repo governance | 發布界線 | **文件可依治理規則直進 main；程式可自主做到 PR／CI／Ready 與非 Production 整合分支合併；Production 仍需明確發布授權。** | 目前 main 會自動發布，所以會改正式行為的 main merge 不可假裝只是一般 git 動作。 |
| #40 | 通知可靠性／免費基礎通道 | **免費用戶至少具備基本 Email + Telegram；重要通知走 transactional outbox + delivery ledger；平台 Owner 每日收到送達健康報告。** | Email accepted 不冒充 delivered；Telegram 200 不冒充已讀；每日 digest 即使 0 failure 也建立並 Email+Telegram 雙送。canonical：`17-NOTIFICATION-DELIVERY.md`。 |
| #40 / Feature Store | Email 功能商業規則 | **基本交易／營運 Email 不再被 `EMAIL_NOTIFICATION` 付費 gate 擋住。** | 若保留該 feature code，只能代表進階 Email 自動化／模板／行銷能力；09 catalog／i18n／gate 必須同步收斂。 |
| #9 / #12 | GUIDE tenant 自有金流 | **每個 GUIDE tenant／工作室用自己的 merchant credentials 完成 checkout→callback；絕不 fallback 平台 key。** | 兩階段驗證：connection verified + e2e verified。Key 修改就清驗證；正式旅客只可使用完整 E2E verified method。canonical：`18-GUIDE-COMMERCE-LIFECYCLE.md` §8。 |
| #41 | 真正散客併團 | **單筆最少人數與最低成團人數分離；1 人可先報 4 人成團方案。** | 多 TourOrder 直接加入同一 SHARED Departure；capacity hold 與 formation qualifying count 分開。 |
| #41 | 成團截止日 | **Plan 預設出發前 7 天，可改 0–90 天；單一 Departure 可 override 並保存 snapshot。** | 短期開團不可偷偷保存已過期 deadline；UI 可建議出發前 24h，但導遊需確認。 |
| #41 | 截止不足／成團後掉人 | **截止不足不自動取消，進 REVIEW_REQUIRED；已成團掉破門檻不反成團，進 AT_RISK。** | REVIEW_REQUIRED：仍成團／延長／取消；AT_RISK：繼續／取消。只有商業判斷交給導遊，客觀狀態由系統自動推進。 |
| #41 / #12 | 訂金／尾款與成團 | **收款政策沿用 Service；線上付款成功自動推進，匯款才人工確認；付款狀態與成團狀態分軸。** | 至少表達 UNPAID／PARTIAL／PAID／REFUND_PENDING／REFUNDED；最後一筆 qualifying payment 原子成團且只產生一次通知 event。 |
| #42 | GUIDE 方案管理 UX | **快速編輯 → 進階設定兩層 UI，但共用同一 TripPlan／API／schema。** | 快速層只給名稱／內容／價格等高頻欄位；成團、販售、季節、訂金等放進階 page／drawer。既有 Departure snapshot 不被 Plan 後改污染。 |
| #42 / #25 | Midao 協助代建方案 | **平台可代建，但導遊仍是可編輯的資料 owner；使用 platform-admin／impersonation + audit，不共用密碼。** | 建議 provenance `GUIDE / PLATFORM_ASSISTED / IMPORTED` 只做來源 badge；LISTED 修改仍走 review。 |
| #43～#48 / GUIDE | HOTCAKE 競品策略 | **採「HOTCAKE 的簡單 × Midao 的旅遊領域深度」；不複製整套美業 CRM，也不以功能數量競賽。** | 北極星是「旅客不用問，導遊不用回」；正式規格為 `19-GUIDE-PRODUCT-EXPERIENCE.md`。 |
| #46 | LINE-first 旅客自助 | **旅客不需下載 App；先選方案再看日期／時間；第一屏只收 3～5 個必要資料，完成頁誠實顯示付款、成團與下一步。** | 固定團次、自選時間、先申請再確認各有手機 E2E；沒有 LINE 的旅客仍可用 Email／手機完成。 |
| #43 | GUIDE 行動收件匣 | **首頁先回答「現在最該處理什麼」；待辦優先於圖表，並由正式訂單／團次／付款／通知狀態推導。** | 立即處理／今天／接下來；每張卡片能直接開到對應資料，不另建第二套手動訂單狀態。 |
| #44 | 旅客履約風險 | **只做租戶私有的客觀紀錄、標籤與預約政策；不做跨導遊共享黑名單或公開信用分數。** | 可強制定金、改為 REQUEST_ONLY、禁止自行下單；原因、操作者、時間需 audit，旅客端不洩漏內部備註。 |
| #45 | GUIDE 營運報表 | **使用旅遊口徑；報表為 P1，完整分析放次層，不占滿 GUIDE 首頁。** | 實收營收、平均客單、取消／未付款、成團、熱門行程／方案、來源、重複旅客與 C+ 業績；沒有可靠詢問事件前不顯示假成交率。 |
| #47 | LINE 開通精靈 | **把 Token／Webhook／圖文選單／額度與測試訊息包成白話自助診斷；每店只用自己的憑證。** | 供應商接受不冒充已讀；失敗可重試且不清空已正確設定，測試派送接 #40 帳本。 |
| #48 | 低風險進場收費 | **不直接照抄競品 NT$400，也不以一定更便宜定位；個人／團隊差異限制導遊席次，不做 SOLO／TEAM 開關。** | 免費／個人／團隊草案先做驗證；基本交易、安全、退款、Email、Telegram 通知不可被進階付費鎖住；正式價格仍需 Owner 再拍板。 |
| GUIDE / P2 | 回流功能排序 | **票券、點數與會員分級保留，但不是 GUIDE P0 主角。** | 主流程穩定後優先跨行程推薦、分享與推薦獎勵；AI 經營建議須建立在可信報表上。 |
| repo / TEST | TEST 資料庫驗證 | **長期授權：可在 Vibe Ai TEST 執行 open Issue 所需 migration、schema／function、DDL／DML、reset、seed、schema cache 與 integration／E2E；後續新 migration 不必逐支再問。** | 僅限 project ref `nmwhwngojosmagjuvxol`；每次先驗 project ref 與基線並留下證據。不含其他 Supabase、Production、正式付款／通知或部署。詳見 `docs/AGENT-EXECUTION.md` §3.1。 |

## 2026-08-27 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #14 | LINE 平台狀態 | 採真實檢查 | Dashboard 真的呼叫 LINE `/v2/bot/info`，加短期快取；LINE 查詢失敗只顯示狀態異常，不拖垮後台。 |
| #17 / #37 | 加購 | 0 元允許、負數禁止；業績採 C+ | 指定人員就歸該人；未指定繼承原預約／團次主導遊；可明確選「不計個人業績」。旅遊團次細節已回併 `10-TOUR-DOMAIN.md`。 |
| #18 | LINE 老闆通知 | 最多 3 位，不按第 4 位人頭加價；每位可有獨立事件開關；旅客自行取消要通知 | 新增接收者時用合理預設。真正會消耗／加購的是 LINE 推播額度，不是接收者席次。 |
| #20 | 看診號碼 | 取消後號碼當日作廢，不重新發給其他病患 | 例如 8 號取消，下一位不可再次拿 8 號；保留稽核與現場辨識的一致性。 |
| #24 | 推薦碼 | 不設有效期限 | MVP 不自行發明 30／90 天；有效推薦碼長期可用。原站「已過期」狀態在沒有新規則前不得自行套期限。 |
| #25 | Midao 管理者代登入租戶 | 要做，作為正式平台能力 | 從 Midao 管理者後台進入指定租戶協助查看／修改。僅 platform admin；全程 audit；租戶可查紀錄；不可取得租戶密碼或共用密碼。 |
| #26 | 第三方登入 | 現在就做 Google + LINE Login | 平台層 OAuth，與每租戶 LINE Messaging API 完全分離；需要平台 Google／LINE Login 憑證與 redirect allowlist。 |
| #37 / Phase 8 | 團次人員 | 方案不綁導遊，團次綁 PRIMARY 主導遊＋ASSISTANT 協同導遊 | 一般預約與團次雙向防撞；主／協同都占用時間；加購 C+。canonical：`docs/integration/10-TOUR-DOMAIN.md`。 |
| #37 / #10 / GUIDE | GUIDE 時間管理 | 不顯示一般店家「班表／封鎖時段」側邊欄；統一在行事曆呈現「可接案／不可接案／已占用」 | 底層重用 `shifts + block_times + trip_departure_staff`，不另建 `guide_availability`。ICS 不輸出大量可接案空檔，只輸出實際占用與不可接案例外。 |
| #37 / #10 / GUIDE | 單導遊／多導遊 UX | **不做 SOLO／TEAM 開關，依 active+bookable 導遊數自動適應。** | 0 位→onboarding；1 位→隱藏人員選擇並自動寫 PRIMARY；2 位以上→顯示 PRIMARY／ASSISTANT 與團隊篩選。停用人員保留歷史關聯。 |
| #37 / #10 / GUIDE | 每位導遊可接案策略 | **每位導遊獨立選「平常可接案」或「僅指定時間可接案」。** | `DEFAULT_AVAILABLE` 不要求 shift coverage；`EXPLICIT_ONLY` 必須完整被 shift 覆蓋。兩者都受 block／booking／departure 等衝突限制。 |
| #37 / GUIDE | 方案販售方式 | **每個 Plan 可選固定團次／自選時間／先申請再確認；最終履約都收斂成 Departure。** | FIXED 可多人加入同一公開團次；INSTANT 成交時建立 PRIVATE Departure；REQUEST 由導遊接受後才進正式履約。 |
| #37 / GUIDE | REQUEST 時段鎖定 | **旅客送出申請時不鎖時間；導遊按接受時才原子重查 availability 並鎖 PRIVATE Departure。** | 多筆待審核申請可指向同一時間；誰先成功被接受誰取得時段。接受後付款保留期限另行裁示。 |
| #9 / #12 / GUIDE | Trip Plan 收款政策 | **沿用商店 Service 的四種收款語意，不建立旅遊專用第二套設定。** | `NONE / DEPOSIT_FIXED / DEPOSIT_PERCENT / FULL`；固定金額／比例訂金共用既有驗證與計算概念；成團與尾款生命週期由 #41 裁示補完。 |
| repo governance | 文件治理 | 已定案的規格／架構／Owner Decision 直接進 `main`；程式仍走 branch→PR→CI | 見 `docs/DOCUMENTATION-GOVERNANCE.md`。 |

## 執行規則

1. 上表已裁示題目不得再次當作人工決策阻擋，除非有新規格衝突、安全風險或 Owner 明確改判。
2. Issue body 若殘留舊人工介入點，以本索引、較新 Owner Decision 與 canonical 文件為準。
3. 實作時把決策回併領域 canonical 文件，不能永久只靠本索引。
4. Production DDL／DML、正式部署與會改變 runtime 的 Production merge，仍需 Owner 另行明確授權。
5. 某一路線缺權限或等待外部服務時，只將該路線列為阻塞；其他安全工作依 B+ 繼續。
6. 每次實質失敗新增或更新 `docs/AGENT-PLAYBOOK.md`；相同根因更新原條目。
7. 任何「已完成」主張都需通過 Completion Truth Gate；尚未重新查證時不得使用完成語氣。