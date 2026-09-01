# 專案自然語言指令與完成事實閘門

> Owner 裁示：2026-09-01
>
> 適用 repo：`smallwei0301/vibeaico-admin-rebuild`
>
> 本文件補充 B+ 執行方式，不取代產品規格。若與較新的 Owner Decision 衝突，以較新的 Owner Decision 為準。

## 1. 自然語言指令

### 「開始 Loop」

等同於開始或安全接續一輪 B+ 出貨迴圈：

1. 從 `origin/main` 載入 B+ orchestration Skill。
2. 重新讀 current main、open Issue、open PR、exact-head CI、shared TEST holder 與最近報告。
3. 若已有 `IN_PROGRESS` Run，接續原 Run，不另建重複 Run。
4. 若沒有進行中的 Run，才建立新 `RUN_ID` 與 JSON ledger。
5. 依 B+ 選一條 MAIN Terra、可選一條 source-only RESERVE Terra、固定 Luna Closure，並優先把窄任務交給 Luna。
6. 直接開始安全施工，不停在純狀態報告。

### 「繼續 Loop」

1. 找到最新 `IN_PROGRESS` Run 與現有 lane。
2. 重新查 GitHub／CI／TEST 現況，不能直接相信上一段對話。
3. 保留 branch、PR、exact head、migration 與測試 checkpoint，不 reset、不重做。
4. 從 `NEXT_SAFE_ACTION` 接續；沒有進行中 Run 時，才按「開始 Loop」建立新 Run。

### 「復盤」或「複盤」

載入 `.agents/skills/vibeaico-agent-retrospective/SKILL.md`，預設唯讀：

- 驗證最近最多三輪 JSON／Markdown 是否可重算；
- 比較 usage、Delivery Unit、Issue close、品質、Luna 採用率、Sol 接觸、CI 與 carryover；
- 先執行完成事實稽核；
- 最多提出兩項下一輪改良；
- 不順便改產品、資料庫、付款、通知或 Production。

### 「復盤並優化」或「複盤並優化」

除上述唯讀檢討外，授權建立一張最小治理 PR，最多實作兩項可稽核的制度改良。不得改寫舊報告、舊分數或歷史資料來讓趨勢變漂亮。

### `/goal`

在本 repo 中，`/goal` 視為「開始 Loop／繼續 Loop」的相容指令：有進行中的 Run 就接續，沒有才建立新 Run。

## 2. Completion Truth Gate（完成事實閘門）

**送出 GitHub／Supabase／Vercel 寫入指令，只代表已提出動作，不代表動作成功。**

任何 Agent 在使用以下字眼前，都必須重新讀取外部系統：

```text
已合併到 main
Issue 已關閉
CI 已全綠
migration 已套用
已部署
檔案已存在於 main
```

### 2.1 PR 合併

必須全部成立才可說「已合併」：

1. 重新 fetch 該 PR，確認 `merged=true` 或有非空 `merged_at`。
2. 取得 `merge_commit_sha`。
3. 重新 fetch default branch，取得最新 main head。
4. compare 證明 merge commit 可由 main head 追溯，狀態為 `ahead` 或 `identical`。
5. 重新讀取至少一個關鍵變更檔的 `ref=main` 內容。
6. 報告列出 PR number、merge commit、main head、驗證時間與關鍵檔案。

只呼叫 merge API、只收到 HTTP 成功、只看到 branch head，均不得說「已合併」。證據尚未取得時，必須寫：

```text
MERGE_REQUESTED_UNVERIFIED
```

### 2.2 CI 全綠

必須以同一 exact head 的 workflow run 為準，且所有必要 job 已終結為 success。仍在 queued／in_progress、只通過 check、或引用舊 SHA，都不得說「CI 已全綠」。未完成時寫：

```text
CI_PENDING
CI_FAILED
CI_GREEN_UNVERIFIED
```

### 2.3 Issue 關閉

執行 close 後重新 fetch Issue，確認 `state=closed`；若 Issue 需要 Sol gate，必須同時有 `CLOSE_APPROVED` 證據。只送出 close 動作時寫 `CLOSE_REQUESTED_UNVERIFIED`。

### 2.4 migration／TEST／Production

- migration 必須重新查精確 project ref 與 migration history。
- TEST 與 Production 證據不得互相代替。
- Production DDL／DML／部署、真實付款／退款／顧客通知仍需另外明確授權。

### 2.5 檔案存在於 main

不能用 PR branch 的檔案冒充 main。必須以 `ref=main` 重新讀取檔案，並確認 main head 是合併後版本。

## 3. 稽核與評分

每輪 ledger／scorecard 必須記錄重要完成主張的證據。發生以下任一狀況，復盤必須標記：

```text
AUDIT_DATA_INVALID
quality.safetyViolations += 1
quality.hardFailReasons += completion claim was not verified
```

- 宣稱合併，但 live PR 顯示未合併；
- 宣稱 Issue 已關，但 live Issue 仍 open；
- 宣稱 CI 全綠，但 exact head 仍 pending／failed 或只跑部分 job；
- 宣稱檔案在 main，但只能從工作分支讀到；
- 宣稱 migration／部署完成，卻沒有精確環境與外部查證。

這類錯誤不能靠其他高分補回。本輪評等至少為 `F-HARD`，並在下一輪先修復事實來源與錯誤交接，避免錯誤狀態一路傳下去。

## 4. 最終回報最低證據

宣告治理 PR 完成時，至少提供：

```text
PR_NUMBER
PR_STATE
MERGED
MERGE_COMMIT_SHA
CURRENT_MAIN_HEAD
EXACT_HEAD_CI_RUN
EXACT_HEAD_CI_RESULT
MAIN_FILES_RE_READ
VERIFIED_AT
```

任何欄位無法取得就明寫 `UNVERIFIED`，不能用推測補洞。

## 5. 作用範圍

這些自然語言指令是 repo／專案層規則，不是 ChatGPT 帳號的全域 Skill。新 Session 只要接管本 repo、從 `origin/main` 讀 `AGENTS.md` 與 Skill，就能重建指令含義；在其他 repo 或沒有讀取本 repo 的一般聊天中，不保證自動生效。
