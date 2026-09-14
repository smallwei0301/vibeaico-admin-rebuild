# 2026-09-14 Playbook 複盤補充候選

> DRAFT。這是本輪準備回併 `docs/AGENT-PLAYBOOK.md` 的教訓與最小修改方案，不是另一份正式規格，也不代表主手冊已更新。
> 來源核對基準：`dbfa970ebca489df2a2a490ae8f9a53c0086c57d`。
> WORKSTREAM: MODEL_GOVERNANCE。使用者本輪要求：把最新複盤發現與建議更新到 Playbook，然後優化。

## 本輪先修正的判讀

1. #359 是 OPTIONAL_NONBLOCKING（選配、不阻擋），不是應自動關閉的廢棄任務。依 `docs/OWNER-DECISIONS.md` 的 2026-09-11 決策保持選配，不索取模型憑證。
2. #412 已合併，三本 Product Run 已有 terminal closeout，但 CompletionTruth 仍為 NOT_CHECKED、缺少量測的欄位仍為 null，不能拿來湊 #104 的三轮可比較樣本。不得重做關帳或把初始零值當成實測零次。
3. #419 已把 PB-038、PB-039 寫進主手冊。本輪沿用，不重編同型教訓。
4. #415 的分類器問題已有 #421 處理逐檔授權。不同 Session 不重做 classifier、model-routing.json 或其範圍測試；不把 `scripts/ci/` 整個目錄放寬。
5. #77、#31、#396、#402 是產品或正式環境工作。複盤可以指出風險與證據缺口，但不接管其分支、TEST lane、正式資料庫或顧客通知。

## 建議回併主手冊的三種證據界線

| 容易誤判的訊號 | 正確判讀 | 接續動作 |
|---|---|---|
| policy 是 v2 | 只表示規則版本，不是本輪治理得分 | 分開查實際 Run、review evidence、生成報告，使用既有程式重算 |
| 工作已 terminal／Issue 已關閉 | 不等於完成真相已核對，更不等於可比較或已出貨 | 保留 NOT_CHECKED／NOT_GRADED，依現有 closeout 權責交接，不補造量測 |
| PR／WIP 庫存下降 | 可以證明庫存減少，不能單憑它判定效率變好 | 分清合併、停放、被取代、等待外部，各自附截止時間與證據 |
| bucket／欄位存在 | 不證明某支 migration 曾執行，也不證明重建等價 | 查整支變更效果、替代沿革、權限、觸發器與帳本別名；不直接補登 |
| Preview 有三個測試通過 | 只證明該 Preview 的三條路徑 | 不外推為 Production 驗收或真正 LINE 冷啟動成功 |
| Gmail 沒有事故通知 | 只表示該時間窗與查詢未找到通知 | 供應商現況另行實查；未查保持未知 |

## 手冊結構的最小優化

- 在「已知教訓索引」前加入短的情境速查表，只導向既有 PB，不複製歷史全文。
- 已有相同根因的 0069 補登錯誤，補入 PB-027 的延伸案例；保留原事件與原始時間。
- 在 PB-015 索引旁註明舊的「一律壓成單一 commit」預防方式已被 2026-09-10 的 `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md` 取代。保留歷史經過，不要求為追新 main 而無意義重整分支。
- 新增一筆「狀態與成果不可混算」教訓，串起 #104、#411／#412 與本次複盤的修正；新的 PB 編號須在實際套用時重新檢查，避免與並行工作撞號。
- 「修正」欄位明確區分已執行與建議待做；補充文件不自動解除任何測試、審查、權限或部署條件。

## 可安全自主進行與不可吸入的工作

純手冊與複盤入口優化可以繼續；不指定治理模型、不新增評分器、不改歷史分數。

涉及產品資料庫的建庫、租戶隔離、Storage、付款與 LINE 實測，仍交原 Product 工作線及既有授權流程。不得因『安全強化』或『只是補帳』而跳過正式環境逐次授權。

## 驗收

- 原 PB 事件與已核准 Owner 決策保留；不因整理而刪除歷史或改計數。
- 快查連結指向存在的原 PB；新內容有來源、影響、修正／預防和驗證界線。
- #359 保持選配；#104 不以 terminal 數量取代可比較資格。
- 不修改 Product Run、metrics policy、分類器、範圍名單、TEST 或 Production。
- 候選不得宣稱已套進主手冊；正常 PR、檢查、審閱、合併與 main 回讀後才可宣稱正式完成。

## 來源

- PR #412：`https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/412`
- PR #419：`https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/419`
- Issue #415／PR #421：`https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/415`、`https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/421`
- Issue #396 的 0069 補登更正：`https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/396#issuecomment-5652730712`
- 現行政策：`docs/OWNER-DECISIONS.md`、`docs/AGENT-EXECUTION.md`、`.agents/skills/vibeaico-agent-retrospective/SKILL.md`。
