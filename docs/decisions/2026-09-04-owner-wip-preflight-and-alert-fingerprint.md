# Owner Decision：WIP Guard 事前檢查、錯誤指紋降噪與主分支保護就緒

- 日期：2026-09-04
- 狀態：APPROVED_WITH_OWNER_GATE
- Owner 指示：依最新複盤改善 WIP Guard 的晚發現、重複通知與 `main` 未保護問題。
- 追蹤 Issue：#164

## 現場證據

最新複盤時間窗中 Gmail 有 37 封 `agent-wip-guard` 失敗通知。抽查代表案例後，主要原因不是 37 個 Product defect，而是：

- 缺少 `REQUESTED_MODEL / ACTUAL_MODEL`；
- 非 `CLOSE_READY` 候選缺少 `WHY_NOT_CLOSER_CANDIDATE`；
- active Terra 沒有 Luna Closure 或 `EMPTY_WITH_SCAN`／`REPORT:` 證據；
- 同一 PR、同一 SHA、同一錯誤因 `edited`、`synchronize` 等事件重複執行。

`main` 的 live branch state 仍為 `protected=false`。目前連接的 GitHub App 可以讀 branch state，但嘗試讀取 protection detail 回傳 `403 Resource not accessible by integration`，也沒有 Administration 寫入能力。因此本決策可以把 Repo 準備好，但不能冒充已啟用 GitHub branch protection。

## 決策一：PR 建立前必須跑 preflight

命令：

```bash
node scripts/agents/agent-wip-preflight.mjs \
  --body /tmp/pr-body.md \
  --changed-files /tmp/changed-files.txt \
  --number 123
```

單 Terra 或治理 PR 不需要 `--changed-files`；active Dual Terra 必須提供。事前檢查至少涵蓋：

- lifecycle Issue；
- Agent lane、state、candidate、closeability、selection reason；
- `WHY_NOT_CLOSER_CANDIDATE`；
- requested／actual model；
- Run 與 scorecard 本機路徑；
- Delivery Slice／standalone／Epic／governance 的計數關係；
- active Product lane 必須指向可結案的 Slice／standalone Issue；
- Dual Terra 的實際 changed files 不得超出 `FILE_OWNERSHIP`。

出現任何錯誤時，不開 PR、不推 no-op commit，也不靠 GitHub Actions 當表單檢查器。

## 決策二：相同錯誤只寄一次，但門禁仍保持紅燈

WIP Guard 以以下內容產生 SHA-256 fingerprint（錯誤指紋）：

```text
PR number
+ exact head SHA
+ 排序、去重後的完整錯誤清單
```

規則：

1. 新 fingerprint 首次出現：workflow failure，寄一次通知。
2. 同一 exact head、同一 fingerprint 再被事件觸發：更新原留言，workflow 以 warning 結束，不再重複寄失敗信。
3. 不論是否消音，固定寫入 commit status：

```text
Agent WIP Policy
```

4. 錯誤存在時 `Agent WIP Policy=failure`；修好才是 `success`。
5. 新 SHA 或錯誤集合改變會形成新 fingerprint，因此仍會產生新的有效警報。
6. Workflow concurrency 改為每張 PR 一條隊伍，新的事件會取消同 PR 的舊執行，不再讓不同 PR 互相塞車。

Branch protection 不得要求「agent-wip-guard workflow 是否成功」作為唯一門禁，因為重複通知消音後 workflow 可以成功結束；必須要求 custom status `Agent WIP Policy`。

## Branch protection Owner gate

自動施工完成後，Owner／具 Administration 權限的工具仍需在 GitHub 設定 `main` ruleset 或 branch protection：

```text
Require a pull request before merging
Require status checks to pass before merging
Required context: Agent WIP Policy
Required context: check
Require branches to be up to date before merging
Do not allow bypassing the above settings
```

`check` 是目前 `ci` workflow 的主要原始碼、typecheck、unit 與 build job 名稱。`Agent WIP Policy` 是本決策新增且對每張 open PR 寫入的穩定 commit status。

Remote canonical TEST、local isolated TEST、scorecard 與 governance scope budget 仍依變更類型執行；在沒有把它們統一成所有 PR 都會產生的穩定 required context 前，不直接硬塞進全域 branch protection，避免合法的 source-only policy skip 永遠無法合併。

### 啟用後的 live 驗收

- `main.protected=true`；
- required status checks 包含 `Agent WIP Policy` 與 `check`；
- 建立一張安全 Draft canary PR，讓 metadata 故意缺欄位；
- workflow 第一次失敗，commit status 保持 failure；
- 編輯 PR body 但不修錯時，不再寄第二封失敗信；
- 修正欄位後 custom status 變 success；
- canary 不合併，關閉後刪除分支。

在上述 live evidence 完成前，Issue #164 的自主程式部分可標記完成，但整張 Issue 必須保持 `OWNER_BLOCKED_COMPLETE`，不得宣稱 branch protection 已啟用。

## 安全邊界

- 不降低 WIP、Dual Terra、shared TEST 或 Sol Audit 規則。
- 不修改 Product runtime、Production DB、Vercel route、付款、退款或顧客通知。
- 不把重複 workflow 的成功結論當成 policy pass；custom status 才是門禁真相。
- 不在沒有 GitHub Administration 權限時偽造 branch protection 完成宣稱。
