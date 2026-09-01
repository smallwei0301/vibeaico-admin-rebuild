---
name: vibeaico-agent-retrospective
description: "Trigger when the Owner says 復盤 or 複盤, asks to review Agent efficiency, token/usage, delivery throughput, quality, CI waste, Luna/Terra/Sol routing, completion truth, or improve the B+ loop in smallwei0301/vibeaico-admin-rebuild. Finds recent reports, verifies completion claims against live systems, recomputes scores, compares trends, and proposes at most two auditable governance changes."
metadata:
  author: smallwei0301
  version: "1.1.0"
---

# VibeAI.co Agent Loop 復盤

## Trigger words

The plain Owner messages `復盤` and `複盤` both trigger this skill. Also use it for requests about
model usage, token efficiency, delivery efficiency, B+ quality, completion truth or Agent-process
improvement.

## Default behavior

A bare `復盤`／`複盤` means read-only review first. Do not modify Product code, Production, payments,
notifications or databases. Governance changes are allowed only when the Owner says「復盤並優化」／
「複盤並優化」or otherwise clearly authorizes implementation.

## Load order

1. Fetch latest `origin/main`.
2. Read:
   - `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
   - `docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
   - `docs/AGENT-BPLUS-DELIVERY-LOOP.md`
   - `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
3. Find `docs/metrics/agent-runs/*.json`, sorted by `startedAt` and filename.
4. Read the latest three completed/baseline runs; if fewer exist, read all.
5. Validate every selected JSON and reproduce its Markdown:

```text
node scripts/agents/run-ledger.mjs validate <run.json>
node scripts/agents/score-run.mjs <run.json> --check <run.md>
```

If a report cannot be reproduced, mark it `AUDIT_DATA_INVALID` and do not trust its score.
6. Generate the comparison with:

```text
node scripts/agents/review-runs.mjs docs/metrics/agent-runs --limit 3
```

## Completion truth audit comes first

Before comparing scores, re-check every important completion claim against live state.

### PR merged

Require all of:

```text
live PR merged=true or merged_at
merge_commit_sha
current default-branch head
compare merge_commit_sha...main = ahead or identical
at least one key file fetched with ref=main
```

A merge API response or branch commit alone is not enough.

### Issue closed

Fetch the Issue and require `state=closed`. When Sol gate is required, verify `CLOSE_APPROVED` evidence.

### CI green

Require the exact candidate SHA and terminal success for every required job. Pending, partial check
success or old SHA evidence cannot be counted as green.

### migration／deployment／external action

Require exact environment/project, live history or provider evidence. TEST does not prove Production.

### Conflict handling

When a report or conversation says completed but live state disagrees:

```text
AUDIT_DATA_INVALID
quality.safetyViolations += 1
quality.hardFailReasons += completion claim was not verified
run grade = F-HARD
```

Do not silently repair history. Preserve the original report, add a correction record, and make the
next Run start from live truth.

## What to compare

```text
weighted_usage_per_delivery_unit
actual token / weekly usage delta when available
unverified model-task count
issues_closed + complete_owner_blocked
audit_ready and unfinished_carryover
cycle_time_minutes
quality and safety score
first-pass CI and invalid reruns
MAIN / RESERVE / active-candidate / shared-TEST peaks
Luna adoption and duplicate task rate
Sol touches per Issue
stale PR descriptions and evidence completeness
completion-claim verification failures
```

Actual token values outrank internal weights. Internal requested-model weights are only a project
comparison ruler; never describe them as OpenAI's official usage ratio.

## Root-cause rules

- High usage + low Delivery Units: inspect context replay, too many Sol touches, duplicate Luna scans,
  too many active candidates and repeated full CI.
- Good output + poor quality: inspect first-pass Audit, unresolved P1/P0, weak acceptance evidence and
  post-merge regression.
- Many Luna calls + low adoption: tasks were too broad, duplicated or missing a single-question output.
- Idle time + low throughput: reserve lane or Luna work was absent while MAIN waited.
- Many carryovers: MAIN exit gate was ignored or scope expanded during review.
- False completion claim: fix the truth source and handoff before changing throughput rules.

## Required output

Use plain Chinese and provide:

```text
1. 完成事實稽核
2. 最近三輪趨勢
3. 哪些地方真的變好
4. 哪些只是看起來忙
5. 最多三個根因
6. 下一輪只調整一到兩項
7. 需要修改的文件／Skill／Hook／程式
8. 不確定或缺少的資料
```

Do not invent token percentages, actual models, Issue closures, merge results or CI status.

## Implementing improvements

When authorized to optimize:

1. Create one governance branch／PR from current main.
2. Change only the smallest canonical docs, skills, scripts, tests and workflows needed.
3. Preserve historical reports. Never rewrite a weak old score to make the trend look better.
4. Add or update tests for every scoring/routing/truth rule.
5. Run exact-head CI once; do not create no-op commits.
6. Sol audits the governance diff.
7. After merge is requested, re-fetch PR, main, compare and main files before saying it merged.
8. Start the next `RUN_ID` with the new rule and compare against the old baseline.

## Guardrail

A retrospective is a mirror, not a bulldozer. It may expose Product defects, but records them for
normal TRIAGE instead of absorbing them into the governance PR.
