# Production 資料庫 Policy-Gated Release Workflow

> Owner 裁示：2026-09-14
> 狀態：`POLICY_APPROVED_AUTOMATION_PENDING`
> 目標狀態：`POLICY_GATED_ACTIVE`
> 適用 repo：`smallwei0301/vibeaico-admin-rebuild`
> Production Supabase：`egehnijjpgijmccagxac`

## 1. 目標

Production DB 不再長期依賴「每次由 Owner 回覆同意」作為安全控制。
改由可重建、可驗證、可失敗關閉（fail closed）的 release workflow 決定是否能進入寫入階段。

但政策與 writer 必須分階段上線：在下列 `AUTOMATION_READY` 條件尚未全部實作並通過 exact-head CI 前，
現行逐次 Owner Production DB gate 暫時保留。這是 bootstrap safety，不是永久人工關卡。
一旦 trusted main 機器驗證 `AUTOMATION_READY=true`，本 repo 後續符合本流程的 Production DB release
自動改為 `PER_RUN_OWNER_APPROVAL=NOT_REQUIRED`，不需要 Owner 再做第二次啟用裁示。

## 2. 不要把安全做成停車場

採 risk-adaptive（依風險加關卡）而不是所有 migration 都跑最大套餐：

| 類型 | 基本關卡 | 額外關卡 |
|---|---|---|
| `ADDITIVE`：向後相容 table/column/index/constraint/function 擴充 | G0–G7 | 不強迫 tenant/backfill 專屬測試 |
| `AUTHZ`：RLS/ACL/auth/tenant boundary/privileged routine | G0–G7 | tenant 正向/反向、非法角色、跨租戶負向測試 |
| `BACKFILL`：非金流、有界資料修復 | G0–G7 | preimage backup、row cap、批次/重跑/並行保護 |
| `DESTRUCTIVE` / unknown | v1 不放行 | 先改成 expand → migrate → contract；不能靠人工特批跳過 |

一般 additive migration 不因為安全治理就被迫做與它無關的租戶測試或資料回填備份。
昂貴檢查只在風險需要時啟動；真正不可省的是 exact source、unexplained drift=0、真 TEST、
可恢復、獨立高風險審查、唯一 writer 與 post-apply readback。

## 3. Release 狀態機

```text
PLAN_LOCKED
→ SOURCE_VERIFIED
→ CONSISTENCY_VERIFIED
→ TEST_VERIFIED
→ RECOVERY_VERIFIED
→ FINAL_RISK_VERIFIED
→ READY_FOR_LOCK
→ READY_FOR_CONTROLLED_APPLY
→ APPLYING
→ APPLIED_VERIFIED
→ PRODUCTION_SCHEMA_READY
```

任一步是 `UNKNOWN`、`NOT_RUN`、`POLICY_SKIP`、expired、證據缺失或 plan digest 不一致，都不是 PASS。
不得用人工 checkbox、聊天同意、舊審查或「CI 綠」單獨替代任一關。

## 4. G0：鎖定 Release Plan

每次 release 建立唯一 `releaseId`，綁：

- current main SHA；
- 精確 migration paths + bytes SHA-256；
- plan digest；
- Production project ref；
- risk tier；
- 依賴物件與影響面；
- 若有資料修復：最大 row count、batch size、條件與 preimage strategy；
- expected TEST / Production before/after fingerprints；
- rollback / forward-repair 路徑；
- 需要的 TEST、Final Risk 與 postcheck。

不能從聊天貼 SQL、branch-only migration、local overlay 或 stale snapshot 產生 writer plan。

## 5. G1：Canonical Source + CI

- migration 必須以最終 bytes 存在於 current `origin/main`；
- worktree / runner SQL 與 main blob 完全相同；
- migration identity 不得 prefix collision；
- required source checks、schema tests、typecheck/unit/build 依 change classification 真正執行；
- source evidence 必須保留 `databaseMutationAuthorized=false`，因為來源正確只是必要條件。

無關 main 前進不強迫重跑所有 expensive evidence；只要 source/plan/risk-policy/relevant blobs 未變，
可重用仍在有效期內的結果。相關內容變動就重新產生 plan digest。

## 6. G2：Scoped Database Consistency

一致性不是要求 TEST / Production 每個角落永遠逐字相同，而是：

1. TEST 已到本次 release 可驗證狀態；
2. Production 的差異只能是：
   - 本 release 精確 planned pending differences；或
   - 已在 trusted main 綁 environment/object/expected+observed fingerprints/Issue/reason/expiry 的 intentional differences；
3. 其他未解釋差異為 0。

任何 planned pending difference 必須同時綁 expected 與 observed fingerprint，避免排隊期間 Production 變成另一種形狀仍被舊 plan 認領。

至少比較本次物件及相依閉包：columns、constraints、indexes、views、routines、triggers、ACL/RLS、migration ledger；
若 release 觸及 enum/sequence/default privilege/role inheritance/Storage/provider setting，必須把對應 read-only evidence 補進本次 plan。
工具沒檢查到的 surface 不能當成 MATCH。

Production/TEST live evidence v1 最長 15 分鐘；未來時間、stale、wrong project、missing ledger 一律 block。

## 7. G3：真實 TEST

- 先 local isolated fresh replay；
- 再唯一 remote TEST holder，使用與 main 相同的 migration bytes；
- 必要 integration/E2E/DB behavior test 必須真的執行，不能 `POLICY_SKIP` 冒充；
- 需要 security boundary 時跑合法/非法/跨租戶正反例；
- cleanup 必須完成；
- TEST 套用後重新 capture drift evidence，再交後續 gate。

## 8. G4：Backup / Recovery

每次 release 自動查 Production backup/PITR availability，使用 project-scoped、read-only backup credential；
backup observer 不得持有 writer token。

- backup evidence capture 必須在 release 前新鮮取得；
- restore rehearsal 不必每支 additive migration 都重做，v1 可重用最近 30 天內成功演練；
- schema/recovery mechanism 有重大變化時重做；
- BACKFILL 額外需要本批精確 preimage evidence；
- DB backup 不得宣稱涵蓋 Supabase Storage object bytes。

## 9. G5：Production Final Risk

每次 Production DB release 都需要 independent Final Risk execution，與 source PR 的一般 risk classification 分開。
使用 trusted-main `scripts/agents/model-routing.json` 的現行 allowlist；目前允許的實際 reviewer identity 必須由既有可信機制證明。

review 必須綁 exact source/plan digest、live consistency evidence、TEST、recovery evidence 與 release risk tier。
`requestedModel == actualModel` 且 actual 在 allowlist 內；unknown 不能放行 Production write。
若 source/plan/relevant schema/risk policy 未變，實質 review 可在 24 小時內重用；G6 live state 仍每次重查。

## 10. G6：唯一 Writer + 最後 Live Recheck

正式 apply 前必須同時有：

- trusted-main preflight verdict；
- project-bound lock；
- plan-bound single-use receipt；
- 取得 lock 後 60 秒內完成 live baseline recheck；
- 正確 project identity；
- migration history/pending set 與 plan 完全相同；
- no stop marker from prior `APPLY_UNKNOWN` / `POSTCHECK_FAILED`。

GitHub concurrency 只防 GitHub workflow 互撞，不足以防其他工具直接寫 DB。
`POLICY_GATED_ACTIVE` 前必須完成 cross-tool writer control：Production schema writer credential 僅存在於受控 apply path，
普通 PR / observer / test 不持有；若仍有旁路工具能直接寫 Production schema，狀態維持 `IMPLEMENTATION_BLOCKED`。

v1 writer 執行限制：

- lock timeout 5 秒；
- SQL statement timeout 60 秒；
- BACKFILL ≤1,000 rows/batch、≤10,000 rows/release；
- payment facts 不在 v1 BACKFILL 授權；
- timeout/connection loss → `APPLY_UNKNOWN`，先 readback，禁止整批盲重送；
- 不使用 Production reset/seed；
- 不靠手動 repair migration ledger 掩蓋 SQL 未實際成功。

優先採 migration-history-aware writer。標準候選為：
`supabase migration list` / `supabase db push --dry-run` 驗 pending set，再執行 `supabase db push`；
若使用 Management API migration endpoint，也必須先證明 endpoint/credential scope 對本專案可用且 plan identity 等價。
現有 `scripts/db/run-migrations.mjs` 不可直接因為 source admission 已綠就當 Production writer；它必須先接本流程並驗證只執行 exact pending set。

## 11. G7：Post-Apply Readback

apply 後重新 read live Production：

- migration ledger identity；
- schema/ACL/RLS/affected objects + dependencies；
- planned data counts / invariants；
- schema cache（需要時刷新）；
- 安全 read/API smoke test；
- planned vs actual diff。

只有完全符合 plan 才是 `APPLIED_VERIFIED` / `PRODUCTION_SCHEMA_READY`。
任何 unexpected difference → `POSTCHECK_FAILED`，停止下一批與 dependent feature activation，保存 durable stop marker。

## 12. Automation Ready 的機器條件

四件事缺一不可：

1. read-only release preflight + scoped consistency adapter + backup observer 已 merge main 且 exact-head CI green；
2. trusted Final Risk evidence adapter 已能驗 current allowed reviewer；
3. controlled writer 已接 exact pending-set verification、single-use plan/lock、postcheck、failure journal，且不存在已知 Production schema write bypass；
4. counterexample/mutation suite 證明 wrong project、stale evidence、unplanned drift、empty test、fake/stale review、missing recovery、receipt replay、parallel writer、partial apply、postcheck fail 都不能進 writer。

當 trusted-main executable policy 產生：

```text
AUTOMATION_READY=true
PRODUCTION_DB_AUTHORIZATION_MODE=POLICY_GATED_ACTIVE
```

本 repo 對本 workflow 範圍內的 Production DB release 自動切換為：

```text
PER_RUN_OWNER_APPROVAL=NOT_REQUIRED
```

不需要 Owner 再做一次人工啟用或逐支 migration 批准。
若 automation 後來健康檢查失效，系統 fail closed 為 `AUTOMATION_DEGRADED`，修技術證據，而不是退回「請 Owner 每次手動同意」作為常態流程。

## 13. 不在此政策內

- Production reset / seed / destructive drop/truncate；
- 真實 payment/refund/order fact mutation；
- customer notifications / LINE provider switch；
- Vercel Production promote/rollback/traffic switch；
- 其他 Supabase project；
- `tour-platform` repo 的 Production DB。

這些仍依各自 canonical 規則。
