# Owner 裁示：B+ 自然語言指令與完成事實閘門

> 日期：2026-09-01
>
> 狀態：Owner 已裁示
>
> 適用 repo：`smallwei0301/vibeaico-admin-rebuild`

## 決策

B+ 正式取代 Mode C 後，本 repo 保留以下自然語言入口：

```text
開始 Loop
繼續 Loop
復盤
複盤
復盤並優化
複盤並優化
```

- 「開始 Loop」：有 `IN_PROGRESS` Run 就接續，沒有才建立新 Run。
- 「繼續 Loop」：從最新 Run、live GitHub、exact-head CI 與 TEST holder 接手，不重做。
- 「復盤／複盤」：預設唯讀，驗證並比較最近最多三輪報告。
- 「復盤並優化／複盤並優化」：最多實作兩項治理改良，不順便改產品。
- `/goal` 與「開始／繼續 Loop」相容。

完整執行方式以 `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` 為準。

## 完成主張必須重新查證

Owner 明確要求：不得再把「已送出動作」寫成「已完成」。以下主張必須重新讀外部系統：

- PR 已合併到 `main`；
- Issue 已關閉；
- exact-head CI 已全綠；
- migration 已套用；
- Production／Preview 已部署；
- 檔案已存在於 `main`。

例如，呼叫 merge API 後必須再 fetch PR、default branch、compare 與 `ref=main` 的關鍵檔案。
在這些證據完成以前，只能寫 `MERGE_REQUESTED_UNVERIFIED`，不能寫「已合併」。

## 稽核後果

未查證卻宣稱完成，會讓後續 Agent 從錯誤起點施工，因此視為嚴重治理缺陷：

```text
AUDIT_DATA_INVALID
quality.safetyViolations += 1
quality.hardFailReasons += completion claim was not verified
本輪最高評等 = F-HARD
```

復盤不得忽略或美化這類錯誤，也不得事後改寫舊報告讓紀錄看起來正確。

## 作用範圍

這是 repo／專案層的持久規則。它會透過 `AGENTS.md`、orchestration Skill、retrospective
Skill 與 `.claude/skills` 入口被新 Session 重新載入；它不是使用者所有 ChatGPT 對話的
全域 Skill，也不代表已修改 ChatGPT Project UI 設定。
