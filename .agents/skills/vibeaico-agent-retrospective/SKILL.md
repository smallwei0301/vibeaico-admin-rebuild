---
name: vibeaico-agent-retrospective
description: "Trigger when the Owner says 復盤 or 複盤, asks to review Agent efficiency, token/usage, delivery throughput, quality, CI waste, Luna/Terra/Sol routing, completion truth, or improve the B+ loop in smallwei0301/vibeaico-admin-rebuild."
metadata:
  author: smallwei0301
  version: "1.2.0"
---

# VibeAI.co Agent Loop 復盤

## 行為

單純「復盤／複盤」先唯讀。只有 Owner 說「復盤並優化／複盤並優化」或明確要求施工，才可修改治理程式與文件。

## 讀取順序

1. Fetch 最新 `origin/main`。
2. 讀最新 Owner Decisions、`docs/DELIVERY-OUTCOME-V2.md`、B+ Loop 與 Completion Truth 規則。
3. 尋找最近最多三個 schema v2 Run。
4. 先驗證 live PR／Issue／CI／main／外部環境，再看分數。
5. 使用：

```text
node scripts/agents/run-ledger-v2.mjs validate <run.json>
node scripts/agents/score-run-v2.mjs <run.json>
node scripts/agents/review-runs-v2.mjs docs/metrics/agent-runs
```

v1 報告只作 `LEGACY_V1` 歷史背景，不和 v2 直接計算趨勢。

## Delivery Outcome v2

```text
shipped_units = verified CLOSED Issue × 1.0
autonomous_outcome_units = CLOSED × 1.0 + verified complete OWNER_BLOCKED × 0.75
```

Audit Ready、exact-head CI only、commit only 與 carryover 是 `wip_inventory`，不是成品。

以下不評分：

```text
IN_PROGRESS
CLOSURE_RECOVERY
缺 end SHA／結束盤點／必要百分比
Completion Truth 尚未 VERIFIED
沒有 verified RUN_COMPLETE claim
```

缺資料不得補中性 50 分。沒有至少一個 `shipped_unit`，不得計算每件真正出貨 usage。

## Completion Truth 先於效率

完成宣稱必須重新查 live state：

- PR merged：`merged=true/merged_at`、merge SHA、main 可追溯、`ref=main` 重讀。
- Issue closed：live `state=closed`，需要時另有 Sol `CLOSE_APPROVED`。
- CI green：同一 exact head 的必要 job terminal success；`skipped` 不等於 green。
- migration／deploy：精確環境與 live history；TEST 不等於 Production。

宣稱與 live state 衝突：

```text
AUDIT_DATA_INVALID
F-HARD
```

保留舊紀錄，新增更正，不改寫歷史。

## 復盤輸出

用白話列出：

1. 完成事實稽核
2. 可比較完成輪次
3. 真正出貨、自主完成、在製品
4. usage／真正出貨與資料限制
5. 品質、CI、Luna／Terra／Sol 分工
6. 最多三個根因
7. 下一輪最多兩項調整
8. 缺少或不確定資料

## 優化施工

- 從 current main 開新治理分支。
- 每張治理 PR 預設最多 8 個檔案、800 行變更；超過就拆，不往大型 Draft 疊 commit。
- 一張 PR 只修一種治理問題。
- 加測試後只跑一次 exact-head CI，不用空白 commit 重跑。
- merge／close 後重新 fetch，未驗證只能寫 `*_REQUESTED_UNVERIFIED`。
- 不吸入 Product、Production、付款、通知或資料庫施工。
