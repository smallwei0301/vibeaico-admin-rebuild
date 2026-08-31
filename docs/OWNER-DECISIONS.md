# Owner Decisions — current index

> 本檔是跨領域 Owner 決策索引，讓 agent 在開工前快速知道哪些題目已經裁示，避免重複詢問。
> 正式領域規格仍以各 `docs/integration/**` canonical 文件為準；Issue 負責施工範圍與驗收。
> 最後更新：2026-08-31。

## 2026-08-31 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #66 / GUIDE | GUIDE 新響應式 UI | **以五張手機基準稿為正式視覺與資訊架構基準；第一層固定為首頁／團次／旅客／訊息／更多** | 手機大字、大卡片、低資訊密度；平板／桌機仍維持同五個父層級；GUIDE 行事曆以月／週／日期團次摘要為主，不做美業式小時時段牆。canonical：`20-GUIDE-RESPONSIVE-UI.md`。 |
| #41 / #12 / #42 | GUIDE 尾款期限 | **預設成團後 48 小時，但導遊可自行修改；常見現場收費方式必須是一級快速選項** | 快速選項至少含 24h／48h／72h／現場收尾款／自訂；NONE 可顯示現場收全額。現場收款不提前標記尾款逾期，實收後由導遊確認。 |
| #41 / #12 | 尾款逾期 | **到期未付不自動取消、不自動釋放名額、不自動沒收訂金；先通知導遊與旅客，由導遊決定延長或取消** | 預設快速選項為「到期未付 → 通知我處理」；現場收尾款／全額的方案在出發前不走一般尾款逾期。canonical decision：`docs/decisions/2026-08-31-guide-balance-payment-deadline.md`。 |
| #41 / #12 / #42 / #46 | 旅客取消／退款規則 | **每個導遊、每個 Trip Plan 可自行設定取消／退款規則；Midao 提供預設範本，不全平台硬綁同一套，也不要求每次人工臨時決定** | Plan 進階設定提供「使用 Midao 建議規則／自行設定」；成交時 snapshot，之後改 Plan 不影響舊訂單；旅客下單前與訂單頁需看到白話政策。預設範本的實際天數／退款比例另逐題裁示。canonical decision：`docs/decisions/2026-08-31-guide-cancellation-policy-config.md`。 |

| repo governance | PR lifecycle Janitor | **不同 Issue 可平行 BUILD；同一 Issue 僅一個 ACTIVE candidate 與最多一個短命 VALIDATION；共享 TEST 仍單一 holder** | 以 `docs/PR-LIFECYCLE.md` 為機械規則；Janitor 只能在明確 metadata、同 Issue、同 repo、祖先關係及 target 未變時關閉 superseded PR，否則 `JANITOR_REVIEW`。 |\n\n## 2026-08-28 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| repo governance | Agent 常駐自主執行 | **長程任務預設持續推進到所有可施工項目完成；階段性回報後不得停工，也不得重問已記錄的授權／裁示** | 依 `docs/AGENT-EXECUTION.md` 盤點 A/B/C、派工、序列化 TEST、保存證據；驗收與最終分支成立後可自主關閉 Issue，只剩真正 Owner／Production 阻塞才結束。 |
| repo governance | 角色式模型派工 | **固定採 `SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra) → DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)`；工作角色優先於目前對話模型** | Sol 決定下一題、模糊 CI、高風險設計與 close verdict；一個中大型 Issue 只交一位 Terra；Luna 做盤點、log、文件與機械收尾。只有 Sol 回覆 `CLOSE_APPROVED` 才可關 Issue。`.agents/skills/vibeaico-agent-orchestration/SKILL.md` 只作執行轉接器，正式規則仍以 `docs/AGENT-EXECUTION.md` 為準。 |
| repo governance | 憑證取得 | **可從已連結 Google Drive `midao.md`／`midao.env` 取得本專案必要憑證，Owner 不負責 seed、登入、cookie 或 API 排錯** | 秘密不可輸出、提交或轉交 agent；真的缺權限才列 Owner 待辦，並繼續其他工作。 |
| repo governance | 發布界線 | **文件可依治理規則直進 main；程式可自主做到 PR／CI／Ready 與非 Production 整合分支合併；Production 仍需明確發布授權** | 目前 main 會自動發布，所以會改正式行為的 main merge 不可假裝只是一般 git 動作。 |
| #40 | 通知可靠性／免費基礎通道 | **免費用戶至少具備基本 Email + Telegram；重要通知走 transactional outbox + delivery ledger；平台 Owner 每日收到送達健康報告** | Email accepted 不冒充 delivered；Telegram 200 不冒充已讀；每日 digest 即使 0 failure 也建立並 Email+Telegram 雙送。canonical：`17-NOTIFICATION-DELIVERY.md`。 |
| #40 / Feature Store | Email 功能商業規則 | **基本交易／營運 Email 不再被 `EMAIL_NOTIFICATION` 付費 gate 擋住** | 若保留該 feature code，只能代表進階 Email 自動化／模板／行銷能力；09 catalog/i18n/gate 必須同步收斂。 |
| #9 / #12 | GUIDE tenant 自有金流 | **每個 GUIDE tenant／工作室用自己的 merchant credentials 完成 checkout→callback；絕不 fallback 平台 key** | 兩階段驗證：connection verified + e2e verified。Key 修改就清驗證；正式旅客只可使用完整 E2E verified method。canonical：`18-GUIDE-COMMERCE-LIFECYCLE.md` §8。 |
| #41 | 真正散客併團 | **單筆最少人數與最低成團人數分離；1 人可先報 4 人成團方案** | 多 TourOrder 直接加入同一 SHARED Departure；capacity hold 與 formation qualifying count 分開。 |
| #41 | 成團截止日 | **Plan 預設出發前 7 天，可改 0–90 天；單一 Departure 可 override 並保存 snapshot** | 短期開團不可偷偷保存已過期 deadline；UI 可建議出發前 24h，但導遊需確認。 |
| #41 | 截止不足／成團後掉人 | **截止不足不自動取消，進 REVIEW_REQUIRED；已成團掉破門檻不反成團，進 AT_RISK** | REVIEW_REQUIRED：仍成團／延長／取消；AT_RISK：繼續／取消。只有商業判斷交給導遊，客觀狀態由系統自動推進。 |
| #41 / #12 | 訂金／尾款與成團 | **收款政策沿用 Service；線上付款成功自動推進，匯款才人工確認；付款狀態與成團狀態分軸** | 至少表達 UNPAID/PARTIAL/PAID/REFUND_PENDING/REFUNDED；最後一筆 qualifying payment 原子成團且只產生一次通知 event。 |
| #42 | GUIDE 方案管理 UX | **快速編輯 → 進階設定兩層 UI，但共用同一 TripPlan/API/schema** | 快速層只給名稱／內容／價格等高頻欄位；成團、販售、季節、訂金等放進階 page/drawer。既有 Departure snapshot 不被 Plan 後改污染。 |
| #42 / #25 | Midao 協助代建方案 | **平台可代建，但導遊仍是可編輯的資料 owner；使用 platform-admin/impersonation + audit，不共用密碼** | 建議 provenance `GUIDE / PLATFORM_ASSISTED / IMPORTED` 只做來源 badge；LISTED 修改仍走 review。 |
| #43～#48 / GUIDE | HOTCAKE 競品策略 | **採「HOTCAKE 的簡單 × Midao 的旅遊領域深度」；不複製整套美業 CRM，也不以功能數量競賽** | 北極星是「旅客不用問，導遊不用回」；正式規格為 `19-GUIDE-PRODUCT-EXPERIENCE.md`，研究與理由分別見 research／decision 文件。 |
| #46 | LINE-first 旅客自助 | **旅客不需下載 App；先選方案再看日期／時間；第一屏只收 3～5 個必要資料，完成頁誠實顯示付款、成團與下一步** | 固定團次、自選時間、先申請再確認各有手機 E2E；沒有 LINE 的旅客仍可用 Email／手機完成。 |
| #43 | GUIDE 行動收件匣 | **首頁先回答「現在最該處理什麼」；待辦優先於圖表，並由正式訂單／團次／付款／通知狀態推導** | 立即處理／今天／接下來；每張卡片能直接開到對應資料，不另建第二套手動訂單狀態。 |
| #44 | 旅客履約風險 | **只做租戶私有的客觀紀錄、標籤與預約政策；不做跨導遊共享黑名單或公開信用分數** | 可強制定金、改為 REQUEST_ONLY、禁止自行下單；原因、操作者、時間需 audit，旅客端不洩漏內部備註。 |
| #45 | GUIDE 營運報表 | **使用旅遊口徑；報表為 P1，完整分析放次層，不占滿 GUIDE 首頁** | 實收營收、平均客單、取消／未付款、成團、熱門行程／方案、來源、重複旅客與 C+ 業績；沒有可靠詢問事件前不顯示假成交率。 |
| #47 | LINE 開通精靈 | **把 Token／Webhook／圖文選單／額度與測試訊息包成白話自助診斷；每店只用自己的憑證** | 供應商接受不冒充已讀；失敗可重試且不清空已正確設定，測試派送接 #40 帳本。 |
| #48 | 低風險進場收費 | **不直接照抄競品 NT$400，也不以一定更便宜定位；個人／團隊差異限制導遊席次，不做 SOLO／TEAM 開關** | 免費／個人／團隊草案先做驗證；基本交易、安全、退款、Email、Telegram 通知不可被進階付費鎖住；正式價格仍需 Owner 再拍板。 |
| GUIDE / P2 | 回流功能排序 | **票券、點數與會員分級保留，但不是 GUIDE P0 主角** | 主流程穩定後優先跨行程推薦、分享與推薦獎勵；AI 經營建議須建立在可信報表上。 |
| repo / TEST | TEST 資料庫驗證 | **長期授權：可在 Vibe Ai TEST 執行 open Issue 所需的 migration、schema/function、DDL/DML、reset、seed、schema cache 與整合/E2E；後續新 migration 不必逐支再問** | 僅限 project ref `nmwhwngojosmagjuvxol`；每次先驗 project ref 與基線並留下證據。不含其他 Supabase、Production、正式付款／通知、部署或 runtime main merge。詳見 `docs/AGENT-EXECUTION.md` §3.1。 |

## 2026-08-27 已裁示

| Issue | 主題 | Owner 決策 | 後續實作重點 |
|---|---|---|---|
| #14 | LINE 平台狀態 | 採真實檢查 | Dashboard 真的呼叫 LINE `/v2/bot/info`，加短期快取；LINE 查詢失敗只顯示狀態異常，不拖垮後台。 |
| #17 / #37 | 加購 | 0 元允許、負數禁止；業績採 C+ | 指定人員就歸該人；未指定繼承原預約／團次主導遊；可明確選「不計個人業績」。旅遊團次細節已回併 `10-TOUR-DOMAIN.md`。 |
| #18 | LINE 老闆通知 | 最多 3 位，不按第 4 位人頭加價；每位可有獨立事件開關；旅客自行取消要通知 | 新增接收者時用合理預設。真正會消耗／加購的是 LINE 推播額度，不是接收者席次。 |
| #20 | 看診號碼 | 取消後號碼當日作廢，不重新發給其他病患 | 例如 8 號取消，下一位不可再次拿 8 號；保留稽核與現場辨識的一致性。 |
| #24 | 推薦碼 | 不設有效期限 | MVP 不自行發明 30/90 天；有效推薦碼長期可用。原站的「已過期」狀態在沒有新規則前不得自行套期限。 |
| #25 | Midao 管理者代登入租戶 | 要做，作為正式平台能力 | 從 Midao 管理者後台進入指定租戶協助查看／修改。僅 platform admin；全程 audit；租戶可查紀錄；不可取得租戶密碼或共用密碼。 |
| #26 | 第三方登入 | 現在就做 Google + LINE Login | 平台層 OAuth，與每租戶 LINE Messaging API 完全分離；需要平台 Google/LINE Login 憑證與 redirect allowlist。 |
| #37 / Phase 8 | 團次人員 | 方案不綁導遊，團次綁 PRIMARY 主導遊＋ASSISTANT 協同導遊 | 一般預約與團次雙向防撞；主／協同都占用時間；加購 C+。canonical：`docs/integration/10-TOUR-DOMAIN.md`。 |
| #37 / #10 / GUIDE | GUIDE 時間管理 | 不顯示一般店家「班表／封鎖時段」側邊欄；統一在行事曆呈現「可接案／不可接案／已占用」 | 底層重用 `shifts + block_times + trip_departure_staff`，不另建 `guide_availability`。ICS 不輸出大量可接案空檔，只輸出實際占用與不可接案例外。 |
| #37 / #10 / GUIDE | 單導遊／多導遊 UX | **不做 SOLO/TEAM 開關，依 active+bookable 導遊數自動適應** | 0 位→onboarding；1 位→隱藏人員選擇並自動寫 PRIMARY；2 位以上→顯示 PRIMARY/ASSISTANT 與團隊篩選。停用人員保留歷史關聯。 |
| #37 / #10 / GUIDE | 每位導遊可接案策略 | **每位導遊獨立選「平常可接案」或「僅指定時間可接案」** | `DEFAULT_AVAILABLE` 不要求 shift coverage；`EXPLICIT_ONLY` 必須完整被 shift 覆蓋。兩者都受 block／booking／departure 等衝突限制；不做租戶級共用開關。 |
| #37 / GUIDE | 方案販售方式 | **每個 Plan 可選固定團次／自選時間／先申請再確認；最終履約都收斂成 Departure** | FIXED 可多人加入同一公開團次；INSTANT 成交時建立 PRIVATE Departure；REQUEST 由導遊接受後才進正式履約。 |
| #37 / GUIDE | REQUEST 時段鎖定 | **旅客送出申請時不鎖時間；導遊按接受時才原子重查 availability 並鎖 PRIVATE Departure** | 多筆待審核申請可指向同一時間；誰先成功被接受誰取得時段。接受後的付款保留期限另行裁示。 |
| #9 / #12 / GUIDE | Trip Plan 收款政策 | **沿用商店 Service 的四種收款語意，不建立旅遊專用第二套設定** | `NONE / DEPOSIT_FIXED / DEPOSIT_PERCENT / FULL`；固定金額／比例訂金共用既有驗證與計算概念；成團與尾款生命週期由 2026-08-28 #41 裁示補完。 |
| repo governance | 文件治理 | 已定案的規格／架構／Owner Decision 直接進 `main`；程式仍走 branch→PR→CI | 見 `docs/DOCUMENTATION-GOVERNANCE.md`。 |

## 執行規則

1. 上表已裁示的題目，不得再次當作人工決策阻擋，除非發現新的規格衝突或安全風險。
2. 若 Issue body 還殘留舊的「人工介入點」，以本索引、對應 Owner Decision comment 與較新的 canonical 文件為準。
3. 實作時要把對應決策回併該領域 canonical 文件，不能永久只靠本索引。
4. Production DDL／DML、正式部署與會改變 runtime 的 Production merge，仍需 Owner 另行明確授權。
5. 某一路線缺權限或等待外部服務時，只將該路線列為阻塞；其他可施工項目繼續，不得以狀態報告提前結束 goal。
6. 每次實質失敗必須新增或更新 `docs/AGENT-PLAYBOOK.md`；相同根因更新原條目，不把教訓散落成多份規格。