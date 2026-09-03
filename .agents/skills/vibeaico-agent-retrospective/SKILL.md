---
name: vibeaico-agent-retrospective
description: "Trigger when the Owner says 復盤 or 複盤, asks to review Agent efficiency, token/usage, delivery throughput, quality, CI waste, Luna/Terra/Sol routing, completion truth, or improve the B+ loop in smallwei0301/vibeaico-admin-rebuild. Finds recent reports, reads Gmail incident notifications, verifies completion claims against live systems, recomputes scores, compares trends, and proposes at most two auditable governance changes."
metadata:
  author: smallwei0301
  version: "1.3.0"
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
   - `docs/DELIVERY-OUTCOME-V2.md`
3. Resolve the requested Run／calendar window in `Asia/Taipei`, then search Gmail for that exact window.
   Search at minimum for the repository／project name and the providers relevant to the Run, including
   Vercel, GitHub Actions, Supabase, Resend／Email and LINE when those systems were touched.
4. Read the full relevant Gmail messages or threads. Search snippets alone are discovery evidence, not
   incident evidence. Record the Gmail query, message IDs, received timestamps, sender／subject and any
   branch, exact SHA, deployment ID, workflow ID, provider error code or quota signal present in the body.
   Never copy access tokens, passwords, keys or full secret-bearing messages into the repository.
5. Find `docs/metrics/agent-runs/*.json`, sorted by `startedAt` and filename.
6. Compare the latest three completed, truth-verified schema v2 runs. Keep schema v1 reports as
   `LEGACY_V1` history and do not mix their Delivery Unit with v2 outcomes.
7. Validate and reproduce selected v2 reports:

```text
node scripts/agents/run-ledger-v2.mjs validate <run.json>
node scripts/agents/score-run-v2.mjs <run.json>
```

Use `agent:run:legacy:*` only to reproduce schema v1 history. If a report cannot be reproduced, mark it
`AUDIT_DATA_INVALID` and do not trust its score.
8. Generate the v2 comparison with:

```text
node scripts/agents/review-runs-v2.mjs docs/metrics/agent-runs
```

## Gmail and external-notification evidence

Gmail is a mandatory retrospective input because provider incidents may appear as clustered emails before
or more clearly than they appear in GitHub. Use it to find deployment floods, quotas, failed builds,
provider rejection, billing warnings and missing notifications.

Evidence precedence is:

```text
live provider API／dashboard state
→ full Gmail message／thread from the provider
→ GitHub provider-bot comment or status
→ PR／Issue prose
```

The higher source wins when timestamps or states disagree. Gmail can prove that a provider sent a notice
at a given time; it does not by itself prove the provider is still failing now. Re-read the live provider
before the final conclusion.

Distinguish these cases:

```text
Gmail search succeeded and returned zero relevant messages → zero notifications found for that query
Gmail connector/search/read unavailable                    → GMAIL_EVIDENCE_UNAVAILABLE
```

`GMAIL_EVIDENCE_UNAVAILABLE` is a disclosed audit gap. It must never be rewritten as「沒有事故」or zero
provider errors. If only snippets are available, report `GMAIL_FULL_BODY_NOT_VERIFIED` and do not infer
branch／SHA／error details absent from the snippet.

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
success, skipped jobs or old SHA evidence cannot be counted as green.

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

## Delivery Outcome v2

```text
shipped_units = live-verified CLOSED Delivery Slice／standalone Issue × 1.0
autonomous_outcome_units = CLOSED × 1.0 + verified complete OWNER_BLOCKED × 0.75
wip_inventory = Audit Ready + CI-only + commit-only + unfinished carryover
```

WIP is reported, never converted into products. `IN_PROGRESS`／`CLOSURE_RECOVERY`, missing final data,
or unverified completion truth are `NOT_GRADED`. Missing percentages are not replaced with 50.
Per-shipped usage is calculated only when `shipped_units >= 1`.

Large planning Epics do not need to close before an independently usable Delivery Slice can close. Follow
`docs/DELIVERY-OUTCOME-V2.md`; never count both one Epic and the already-counted child Slices as separate
copies of the same product outcome.

## What to compare

```text
weighted_usage_per_shipped_unit
weighted_usage_per_autonomous_outcome
actual token / weekly usage delta when available
unverified model-task count
shipped_units + autonomous_outcome_units
wip_inventory and unfinished_carryover
cycle_time_minutes
quality and safety score
first-pass CI and invalid reruns
MAIN / RESERVE / active-candidate / shared-TEST peaks
Luna adoption and duplicate task rate
Sol touches per Issue
stale PR descriptions and evidence completeness
completion-claim verification failures
Gmail provider-notification count and clustered incident count
Gmail／live-provider／GitHub status disagreements
Vercel deployment count split by main, explicit Preview and blocked branch
```

Actual token values outrank internal weights. Internal requested-model weights are only a project
comparison ruler; never describe them as OpenAI's official usage ratio.

## Root-cause rules

- High usage + low shipped outcomes: inspect context replay, too many Sol touches, duplicate Luna scans,
  too many active candidates and repeated full CI.
- Good output + poor quality: inspect first-pass Audit, unresolved P1/P0, weak acceptance evidence and
  post-merge regression.
- Many Luna calls + low adoption: tasks were too broad, duplicated or missing a single-question output.
- Idle time + low throughput: reserve lane or Luna work was absent while MAIN waited.
- Many carryovers: MAIN exit gate was ignored or scope expanded during review.
- False completion claim: fix the truth source and handoff before changing throughput rules.
- Many provider emails for one branch／minute: inspect automatic deployment fan-out, repeated commits,
  branch allowlists and whether one explicit acceptance deployment could replace intermediate Previews.
- Gmail is quiet while live provider shows failures: inspect notification recipients, filters and provider
  email settings; do not conclude the provider was healthy.

## Required output

Use plain Chinese and provide:

```text
1. 完成事實稽核
2. Gmail／外部通知事件摘要（含查詢時間窗、message IDs 或不可用狀態）
3. Gmail、GitHub 與 live provider 的差異
4. 最近三輪趨勢
5. 哪些地方真的變好
6. 哪些只是看起來忙
7. 最多三個根因
8. 下一輪只調整一到兩項
9. 需要修改的文件／Skill／Hook／程式
10. 不確定或缺少的資料
```

Do not invent token percentages, actual models, Issue closures, merge results, CI status or missing Gmail
content. Do not print message bodies that contain credentials or personal data.

## Implementing improvements

When authorized to optimize:

1. Create one focused governance branch／PR from current main for each governance concern.
2. Default budget is at most 8 changed files and 800 changed lines; split work instead of exceeding it.
3. Change only the smallest canonical docs, skills, scripts, tests and workflows needed.
4. Preserve historical reports. Never rewrite a weak old score to make the trend look better.
5. Add or update tests for every scoring/routing/truth rule.
6. Run exact-head CI once; do not create no-op commits.
7. Sol audits the governance diff.
8. After merge is requested, re-fetch PR, main, compare and main files before saying it merged.
9. Start the next `RUN_ID` with the new rule and compare against the old baseline.
10. Record Gmail evidence as redacted metadata only: query window, message ID, time, provider and incident
    classification. Never commit message bodies, recipient addresses or secrets merely to make an audit look complete.

## Guardrail

A retrospective is a mirror, not a bulldozer. It may expose Product defects, but records them for
normal TRIAGE instead of absorbing them into the governance PR.
