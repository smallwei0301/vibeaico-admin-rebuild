---
name: vibeaico-astra-review
description: Review high-risk VibeAI admin changes with Astra after Sol and test evidence are ready; classify payment consistency, tenant authorization, irreversible data, cross-repo contracts and governance gates without escalating ordinary UI work.
---

# Astra 最後風險評估

從 trusted main 讀 `docs/MODEL-ROUTING.md` 與 `scripts/agents/model-routing.json`；模型 ID 與
風險判準以該單一設定為準。保留 `docs/AGENT-EXECUTION.md` 的授權與 Sol 結案門檻。

1. 開工由 Sol 填風險分類及理由；實際變更範圍擴大時重新分類。
2. 必要測試與 Sol diff 審核完成後，整理 repo、base/head、policy、TEST/schema 基線、
   diff、測試連結、Sol 疑點與未驗證事項。不要搬完整對話或秘密；保留按需讀原檔能力。
3. 使用可確認的設定模型建立獨立唯讀評估，要求具體反例、阻塞項目與剩餘限制。
   不以一般主 Agent 的回答冒稱 Astra。缺模型／缺證據留 ASTRA_PENDING。
4. 把實際結果記在 GitHub，操作人依 canonical 格式提交 review 背書；使用 COMMENT
   可保留既有獨立 Sol approval 流程。PASS、FIX_REQUIRED、PENDING 必須如實記錄。
5. 提交／編輯／撤銷評估後留言 `/astra-review-check`，合併前也刷新並等待完成；重新查候選版本及門禁結果；基線改變即重評。正常只重審影響範圍，影響不明時擴大。

Astra 不替代測試、實機驗收、正式操作授權或 Sol 關閉議題權限。不為節省配額放過必要審核。
未知實際用量保持 unknown；不得為 Astra 捏造官方 token／成本倍率。
