# Owner Decision — 交付完成、v4 結案與 Sol／雙 Terra 對齊

> 裁示日期：2026-09-07
> 追蹤 Issue：#207
> 範圍：治理；不改產品行為、既有帳本或既有 agent 腳本。

## 裁示

### 1. `CLOSED` 與出貨分開

`CLOSED` 只表示 Issue 已依 Sol 最終結論完成結案；它不是 shipped unit。只有同一 Issue 已依序取得：

```text
SOURCE_VERIFIED
→ MERGED_TO_MAIN
→ AUTO_VERCEL_DEPLOYED
→ PRODUCTION_SCHEMA_READY
→ AUTHENTICATED_PRODUCTION_ACCEPTED
```

才可計為 `shipped_unit`。最後一階必須是登入正式站後的實機接受測試；沒有它一律
`PRODUCTION_PENDING`，即使 Issue、PR、CI 與自動部署均已完成。

### 2. 新 Run 使用既有 v4 closeout

新 operational Run 使用既有 `scripts/agents/run-ledger-v2.mjs` 建立 schema v2、
`deliveryTruthVersion: 4` 帳本，並指定唯一 `--closeout-owner`。final Run 只有在既有 validator
驗證 `closeout.state=CLOSED`、`closedAt=endedAt`、40 字元 `main.endSha`、結束 inventory 及 durable
`evidenceRef` 後才可結案。schema v1 與歷史 DeliveryTruth v2／v3 帳本保留原樣，只能用既有 score／review 工具重算。

### 3. Sol 分早期 diff audit 與最終放行

Terra 產生可審完整 diff 後，Sol 可做一次早期 diff audit，以便在必要測試前發現假成功、半接線與
邊界 no-op。早期 audit 只能提供建議或 `FIX_REQUIRED`，不得 `CLOSE_APPROVED`。

最終順序固定為：

```text
Terra → early Sol diff audit → 必要修正 → local isolated
→ canonical TEST（需要時）→ final Sol audit（final exact head）→ merge
→ 合併事實五項驗證 → 自動部署證據 → Production schema ready 證據
→ 正式登入實測接受 → 確認出貨五階全成
```

最終 Sol 必須讀必要測試完成後的 final exact-head diff；head 有變動時不得沿用早期 audit。缺少必要測試或
最終 audit 時不得放行。合併事實五項只驗證 `MERGED_TO_MAIN`，其後三階各自即時收證；Issue close 依最終 Sol
結論另行記錄，不能取代任何出貨階段。

### 4. 雙 Terra 是條件入口

完整 Terra 預設一條。只有 executable Guard 在啟動前確認兩條候選具備同一 `RUN_ID`、不同 primary Issue、
`TERRA_SLOT` 1／2、`TEST_ENV_ID`、零重疊 `FILE_OWNERSHIP`、各自健康的 local isolated 證據，且沒有 shared
TEST holder 衝突時，才可同時執行兩條。Reserve 在雙 Terra 時為 0。

任一契約缺漏、local cleanup 失敗、slot 不健康、檔案撞車或跨線污染，立刻退回單一完整 Terra。遠端 canonical
TEST、最終 Sol audit 與 merge 均維持單線。

## 落地位置

- Canonical 執行與交付規則：`AGENTS.md`、`docs/AGENT-EXECUTION.md`、
  `docs/AGENT-BPLUS-DELIVERY-LOOP.md`、`docs/DELIVERY-CHAIN.md`
- 操作與復盤轉接：`.agents/skills/vibeaico-agent-orchestration/SKILL.md`、
  `.agents/skills/vibeaico-agent-retrospective/SKILL.md`
- 既有實作：`scripts/agents/run-ledger-v2.mjs`、`score-run-v2.mjs`、`review-runs-v2.mjs`
