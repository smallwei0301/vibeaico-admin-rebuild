# Owner 裁示：Agent 可自行 merge，不需逐次授權

日期：2026-10-22。來源：Owner 在對話中直接指示「修改永久規則不用我授權merge」（當時正在處理 vibeaico PR #1094 與 tour-platform PR #1908）。

## 裁示

Agent 負責的 PR，只要通過所屬 Workstream 的全部既有關卡，就可以自行 merge 進 `main`，不需要再請 Owner 逐次授權。本裁示取代 `AGENT-EXECUTION.md` §3「程式／workflow／skill 合併 main：需明確任務授權」的逐次授權要求。

## merge 前仍必須全部成立

- exact head 的 required checks 全部 success，沒有 merge conflict；branch protection 照常生效，不得繞過或暫時關閉。
- 依所屬 Workstream 完成審查：
  - `PRODUCT_MAINLINE`：沿用 Sol／Final Risk 規則。
  - `MODEL_GOVERNANCE`：完成 exact-diff 反例審查。
- 已觸發的 bot review（例如 Codex code／security review）要先跑完；blocking finding 修正並回讀後才 merge，不得在 review 進行中搶先 merge。
- merge 後依 Completion Truth 讀回：PR merged、merge commit 可由 main 到達、關鍵檔案以 `ref=main` 重讀，以及 merge commit 上的 main CI 結果。

## 不在本授權範圍（維持原規則）

- Production DDL／DML／migration：§3.2 staged policy gate。
- Production reset／seed／災難性刪除：禁止。
- 手動 Production deployment／promote／流量切換／rollback：需另行授權。
- 真實付款、退款、訂單或顧客通知：禁止。
- 修改或繞過任何 required check、branch protection、Final Risk 成本規則。

## 已知後果

`main` 會觸發 Vercel 自動部署。因此，依本裁示 merge 會改變正式行為的 PR 時，既有流程會自動把它部署到正式站；這是本授權接受的結果，不需另外請示。上面「不在本授權範圍」所列的手動部署操作仍需授權。
