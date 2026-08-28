# 角色式模型路由與 agent skill

> 日期：2026-08-28
>
> 狀態：Owner 已裁示

## 決策

專案的長程 `/goal` 與 Issue 收斂，改採工作角色優先的固定管線：

```text
SCOUT(Luna) → TRIAGE(Sol) → BUILD(Terra) →
DIAGNOSE(Terra/Sol) → AUDIT(Sol) → CLOSEOUT(Luna)
```

目前對話選到的模型只負責維持工作不中斷與工具協調，不能跳過角色閘門。

- Sol：決定下一個 Issue 與依賴、判斷模糊 CI、審查資料庫／付款／登入／權限／安全，
  並輸出最終 close verdict。
- Terra：一個中大型 Issue 由同一位端到端施工、除錯與跑 targeted tests。
- Luna：盤點、log 壓縮、文件同步、狀態更新與已有標準答案的機械工作。
- Issue 必須收到 Sol 的 `CLOSE_APPROVED`，才可由 Luna 或主 agent 執行關閉。

## 原因

先前「目前模型統籌全部工作」容易讓高階模型花費在搬運，也容易讓 Terra 在大型
CI／TEST 環境問題上自行判案。固定角色閘門可同時降低重複閱讀、盲目重跑與高階模型
用量，又保留 Sol 在依賴、風險與最終驗收上的判斷力。

初始工作量目標為 Sol 10%～20%、Terra 60%～70%、Luna 15%～25%。若平台沒有真實
token 數據，不編造使用量，改以 Sol 接觸、full CI、無效重跑、AUDIT 退回與新增
blocking Issue 數量衡量。

## Skill 決策

建立 `.agents/skills/vibeaico-agent-orchestration/SKILL.md`，並以
`.claude/skills/vibeaico-agent-orchestration` symlink 供 Claude 類 agent 載入。

此 skill **需要建立**，因為它能在 `/goal`、多 agent 派工、模糊 CI 與 closeout
自動把文件規則轉成固定流程，減少每個 session 重複貼長提示詞。

skill 只是一層薄的 execution adapter（執行轉接器），不得複製另一套完整治理規格。
若 skill 與 `origin/main:docs/AGENT-EXECUTION.md` 衝突，以 canonical 文件為準。

## 影響

- 更新 `docs/AGENT-EXECUTION.md` §5 與 close gate。
- 更新 `AGENTS.md` 的開工入口與摘要。
- skill、程式、workflow 等非 docs-only 路徑仍走 feature branch → PR → CI → review。
- 不改網站 runtime、Production Supabase、付款或真實通知。
