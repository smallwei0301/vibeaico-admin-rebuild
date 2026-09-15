# Product Scorecard Live Readiness

> Status: canonical companion for Issue #462. This document does not create a third score surface and does not change the 100-point formula. It defines when existing Product score inputs must be captured so that `score-run-v2.mjs` can actually grade a terminal Run.

## Problem

The current system is truthful but too late: a Product Run may stay `IN_PROGRESS` for hours, merge several PRs, run CI, perform review and closure sweeps, then only at retrospective/closeout discover that required percentage inputs are still `null`. Historical facts cannot be safely reconstructed after the fact, so the final result becomes `NOT_GRADED` again.

The fix is not to invent values. The fix is to surface missing score inputs while the events are still observable.

## One score, two views

```text
LIVE READINESS
→ Can this active Run still become honestly gradable?
→ Shows missing live-capture fields now.

FINAL SCORE
→ Existing score-run-v2 100-point score.
→ Only terminal + Completion Truth verified + all required inputs present.
```

Live Readiness is not a score and is not comparison-eligible. It is a data-capture health check.

## Command

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json
```

Machine-readable form:

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json --json
```

Checkpoint gate:

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json --strict-live
```

`--strict-live` exits non-zero only for invalid ledgers, missing live-capture inputs, or internal consistency warnings. It does **not** fail merely because terminal-only fields such as `endedAt` are naturally pending during an active Run.

## Input classes

### Live-capture inputs

These must be maintained while the Run is active. If they remain missing until closeout, the Run will become `NOT_GRADED` and the missing fact may no longer be reconstructable honestly.

- `ci.firstPassRatePercent`
- `quality.acceptanceEvidenceCoveragePercent`
- `quality.auditFirstPassRatePercent`
- `flow.lunaDelegationRatePercent`
- `flow.waitTimeConvertedPercent`
- `auditability.evidenceFieldsCompletePercent`
- `auditability.exactHeadTestCoveragePercent`
- `auditability.preciseBlockersPercent`

### Closeout-derived inputs

These can be calculated at closeout from already captured raw facts / the previous comparable Run. They are not a reason to fail an active Run's live readiness.

- `modelUsage.weightedUsageImprovementPercent`
- `auditability.scoreInputsCompletePercent`

The readiness tool independently calculates observable score-input completeness and warns when a stored `scoreInputsCompletePercent` disagrees with the fields actually present.

### Terminal-only inputs

These are expected to remain pending during active work:

- `endedAt`
- `main.endSha`
- `inventory.openIssuesEnd`
- `inventory.openPrsEnd`
- closeout envelope
- `completionTruth.status/checkedAt`

## Required checkpoints

A Product Main Session must run or logically perform the same readiness check at four checkpoints:

1. **RUN START**
   - create/reuse `RUN_ID`;
   - record start main SHA and inventory;
   - immediately see which live fields need future capture.
2. **OBSERVABLE EVENT**
   - after each accepted/rejected Agent task, full CI attempt, Final/Audit verdict, TEST collision, safety violation, closure sweep, or other event used by a score input;
   - update raw counters/facts first, then refresh readiness.
3. **DELIVERY STAGE CHANGE**
   - after merge, Issue close/owner-blocked disposition, Vercel Production READY, Production schema readiness, authenticated Production acceptance;
   - update Completion Truth evidence and coverage while the provider state is still easy to verify.
4. **PRE-CLOSEOUT**
   - `liveCaptureMissing` must be empty before terminal closeout unless the Run explicitly ends `OWNER_BLOCKED` because the missing evidence itself is externally unavailable;
   - missing historical observations must remain missing. Never backfill a guess just to make readiness green.

## Friction rule

Deterministic metadata must be validated before spending remote CI:

```text
PR metadata / TEST_PROFILE / lane / candidate / Final Risk metadata
→ local/trusted preflight first
→ only then push / dispatch remote CI
```

Do not use GitHub Actions as an interactive form validator. A deterministic metadata failure is a preflight defect or a preflight-coverage gap. Fix the local validator or shared parser instead of teaching every Agent another prose exception.

## What this does not change

- Completion Truth remains mandatory.
- `CLOSED` still does not mean shipped.
- Production five-stage truth remains unchanged.
- TEST holder / shared TEST safety remains unchanged.
- Product Final Risk remains unchanged.
- MODEL_GOVERNANCE remains model-agnostic.
- Historical ledgers remain immutable and are not retroactively repaired.

## Proposed `docs/AGENT-EXECUTION.md` §10 insertion

The following is the exact bounded text intended to be merged into §10 once the active file owner / parallel diff is clear:

```md
### 10.1 Live Scorecard Contract（不要等復盤才發現沒資料）

Scorecard 有兩個視角但只有一套分數：`LIVE_READINESS` 是 active Run 的資料完整度檢查；`FINAL_SCORE` 才是既有 `score-run-v2.mjs` 的 terminal 100 分。Live readiness 不可拿來跨 Run 比較，也不可冒充分數。

執行：

`node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json`

固定 checkpoint：

1. Run start：建立／接續 ledger 後立即跑一次。
2. 每次 accepted/rejected Agent task、full CI、Audit/Final Risk、TEST collision、安全事件或 closure sweep 後：先更新 raw facts，再跑 readiness。
3. 每次 merge／Issue close／Owner-blocked／Vercel Production READY／Production schema／authenticated Production acceptance 後：立即更新 Completion Truth / coverage，再跑 readiness。
4. closeout 前：`liveCaptureMissing` 必須為空；不可在 closeout 倒推或猜測已經失去的歷史資料。

Live-capture 欄位與 terminal-only 欄位的 canonical 分類見 `docs/metrics/SCORECARD-LIVE-READINESS.md`。缺 terminal-only 欄位在 active Run 是正常；缺 live-capture 欄位是現在就要處理的資料品質問題。

Deterministic metadata 先跑 preflight。PR body / TEST_PROFILE / lane / candidate / Final Risk metadata 若在 CI 才第一次被發現錯誤，優先補 preflight coverage；不得把 remote CI 當規格查詢器，也不得為同一 metadata 問題堆 no-op commit。
```
