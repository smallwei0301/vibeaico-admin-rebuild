const FIELD_NAMES = [
  "WORK_ORIGIN",
  "AGENT_LANE",
  "LANE_STATE",
  "ACTIVE_CANDIDATE",
  "CLOSEABILITY_SCORE",
  "SELECTION_REASON",
  "REMAINING_AUTONOMOUS_STEPS",
  "OWNER_OR_EXTERNAL_BLOCKER",
  "CLOSURE_SWEEP_TARGET",
  "TEST_LANE_REQUIRED",
  "WHY_NOT_CLOSER_CANDIDATE",
  "REQUESTED_MODEL / ACTUAL_MODEL",
  "BPLUS_MODE",
  "RUN_ID",
  "RESERVE_BOUNDARY",
  "SCORECARD_PATH",
];

export const ALLOWED = Object.freeze({
  lane: new Set(["TERRA_BUILD", "TERRA_RESERVE", "LUNA_CLOSURE", "TEST_VALIDATION", "GOVERNANCE"]),
  state: new Set(["ACTIVE", "PARKED", "COMPLETE", "OWNER_BLOCKED", "HISTORICAL", "READY_FOR_PROMOTION"]),
  boolean: new Set(["TRUE", "FALSE"]),
  reason: new Set([
    "CLOSE_READY",
    "DEPENDENCY_UNLOCKER",
    "P0_RUNTIME",
    "P1_SOURCE_HARDENING",
    "OWNER_DIRECTED",
    "GOVERNANCE",
  ]),
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 同時可存在的 Product candidate 上限（Owner 2026-09-09 裁示：2 → 3）。
 *
 * ⚠️ 這是**單一事實來源**。在此之前同一個數字硬編碼在九個位置：本檔的檢查、
 * `dual-terra-wip-policy.mjs` 的檢查、`agent-wip-guard.yml` 摘要與 PR 留言各一次的
 * `.../2` 字串、同一支 workflow 裡 `candidate:active` label 的描述（`createLabel`
 * 會把它寫進 GitHub），以及 `score-run.mjs` 三處（`wipHealthy` 判定、建議文字、
 * 報告的「目標 ≤2」）與 `score-run-v2.mjs` 一處（完成度加分）。
 *
 * 第五處與第六～九處都是逐輪風險評估一處一處挖出來的——「我掃過了」在這件事上
 * 被推翻過兩次，所以測試裡的每一條鎖都附對照組並經過變異驗證。
 *
 * ⚠️ 這九處**不是等價的**，說清楚以免下一個人誤判改哪裡有效：
 *
 *   - 真正在跑的只有 **`agent-wip-guard.yml` → `dual-terra-wip-policy.mjs` 的
 *     `validateGlobalWip`**。那是全 repo 唯一非測試的**進入點**（guard 直接呼叫一次，另經 dual-terra 的 `pilotCapacity()` 間接再呼叫一次，兩條都源自同一支 workflow）。
 *   - `ci.yml` 確實 `import` 了本檔，但**只呼叫 `decideTestValidation`**（TEST lane
 *     判定），那條路徑從不碰 `validateGlobalWip`。所以**本檔的 candidate 上限在 CI
 *     裡是死碼**，目前只有單元測試在執行它。
 *   - `score-run.mjs` 與 `score-run-v2.mjs` **兩支都在 CI 真的跑**
 *     （`agent-run-scorecard.yml`、`agent-run-ledger-reconcile.yml`），但它們**不擋 PR**，
 *     是評分：上限沒跟著放寬時，一個峰值 3 的**合規** Run 會被扣 3 分完成度、標成
 *     `wipHealthy=false` 並被建議「收斂候選」——把合規行為報成違規。
 *
 * 既然是死碼，為什麼還要一起收斂？因為 dual-terra 的 `validateGlobalWip` 是**另一份
 * 獨立實作**（不是呼叫本檔的），兩份各自帶一個數字。今天沒人跑本檔這一份，不代表
 * 明天沒有；留兩個會分岔的數字，就是留一顆之後才會爆的雷。
 *
 * 同型的漂移今天才在 `src/lib/shop-code.ts` 修過一次（店家代碼規則散在四處且
 * 不一致）。這裡一併收斂，並由 `tests/unit/candidate-cap-single-source.test.ts`
 * 鎖住「字面量只准出現在這一行」。
 */
export const MAX_ACTIVE_CANDIDATES = 3;

/**
 * Fenced code blocks are documentation, never metadata.
 *
 * ⚠️ 這一行是實測抓到的**放行漏洞**，不是理論疑慮。`readField` 取的是第一個匹配，
 * 而 `.github/pull_request_template.md` 的示範區塊裡有 `ASTRA_RISK: NONE`、
 * `AGENT_LANE: GOVERNANCE`、`FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY`。
 * 作者只要沒把樣板刪乾淨，他在下方誠實填的值就永遠讀不到——實測以 main 的真實範本
 * 重現：作者宣告 `ASTRA_RISK: TENANT_AUTH_BOUNDARY`，`classifyAstra()` 讀到 `NONE`
 * 並回 `required=false`，高風險宣告被整個吞掉。
 *
 * 修在 reader 而不是只改範本：範本可能被改回去，而 fence 出現在 PR 內文的方式不只
 * 一種（引用他人留言、貼設定片段、示範 YAML）。從讀取端拿掉，所有消費者
 * （`parseLaneMetadata`、`classifyWorkstream`、`classifyAstra`、preflight）一次修好。
 *
 * 安全性：實測 60 份 PR（含已關閉）在移除 fence 前後，九個治理欄位的讀值**零處改變**，
 * 因此沒有任何既有 PR 把真實中繼資料放在 fence 裡。
 */
const withoutFencedBlocks = (body) =>
  String(body).replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");

/**
 * 一個欄位只能宣告一次。
 *
 * 移除 fenced block 只擋得住「三個反引號且正確閉合」那一種容器。Final Risk 第二輪實測
 * 指出還有四種漏網：**未閉合**的 fence（正則需要閉合標記）、四個反引號／波浪號的 fence、
 * 四空格縮排的 code block、以及多行 HTML 註解。它們都能把一組假的宣告藏在作者的真實
 * 宣告之前，而 `readField` 取第一個匹配。
 *
 * 與其逐一追殺容器語法，直接改掉「第一個匹配獲勝」這個前提：同一欄位在**原始內文**
 * （不移除任何容器）中出現多個不同的值時，回傳一個必然被拒的哨兵值。它含 `|`，因此
 * `isPlaceholder()` 判為佔位符；它也不是任何列舉的合法值，因此各 classifier 會報錯。
 * 兩條既有的 fail-closed 路徑都會接住它，不需要每個消費者各自處理。
 *
 * 安全性實測：60 份 PR（含已關閉）在 13 個治理欄位上，只有 1 處出現多值——已關閉的
 * #310 的 `ACTIVE_CANDIDATE`。因此這條規則不會誤傷正在進行的工作。
 */
export const AMBIGUOUS_FIELD = "AMBIGUOUS|DECLARED_MORE_THAN_ONCE";

export function readField(body = "", field) {
  // Do not use \s around one metadata row: \s consumes newlines and can swallow the next field.
  const source = `^[ \\t]*[-*]?[ \\t]*${escapeRegExp(field)}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`;
  const declared = new Set(
    [...String(body).matchAll(new RegExp(source, "gmi"))]
      .map((match) => (match[1] ?? "").trim())
      .filter(Boolean),
  );
  if (declared.size > 1) return AMBIGUOUS_FIELD;
  return (withoutFencedBlocks(body).match(new RegExp(source, "mi"))?.[1] ?? "").trim();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isPlaceholder(value) {
  const text = String(value ?? "").trim();
  return !text || text.includes("<!--") || text.includes("|") || /^(TBD|N\/A|UNKNOWN|-)$/i.test(text);
}

export function readLifecycleIssue(body = "") {
  const match = String(body).match(/<!--\s*pr-lifecycle([\s\S]*?)-->/i);
  if (!match) return null;
  const issueMatch = match[1].match(/^\s*issue\s*:\s*(\d+)\s*$/mi);
  if (!issueMatch) return null;
  const value = Number(issueMatch[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseLaneMetadata(pr = {}) {
  const body = pr.body ?? "";
  return {
    number: Number(pr.number ?? 0),
    htmlUrl: pr.html_url ?? "",
    issueNumber: readLifecycleIssue(body),
    origin: upper(readField(body, "WORK_ORIGIN")),
    lane: upper(readField(body, "AGENT_LANE")),
    state: upper(readField(body, "LANE_STATE")),
    activeCandidate: upper(readField(body, "ACTIVE_CANDIDATE")),
    closeability: readField(body, "CLOSEABILITY_SCORE"),
    selectionReason: upper(readField(body, "SELECTION_REASON")),
    remainingSteps: readField(body, "REMAINING_AUTONOMOUS_STEPS"),
    blocker: readField(body, "OWNER_OR_EXTERNAL_BLOCKER"),
    closureTarget: readField(body, "CLOSURE_SWEEP_TARGET"),
    testLaneRequired: upper(readField(body, "TEST_LANE_REQUIRED")),
    whyNotCloser: readField(body, "WHY_NOT_CLOSER_CANDIDATE"),
    requestedModel: readField(body, "REQUESTED_MODEL / ACTUAL_MODEL"),
    bplusMode: upper(readField(body, "BPLUS_MODE")),
    runId: readField(body, "RUN_ID"),
    reserveBoundary: readField(body, "RESERVE_BOUNDARY"),
    scorecardPath: readField(body, "SCORECARD_PATH"),
  };
}

function isBplusDeliveryLane(metadata) {
  return ["TERRA_BUILD", "TERRA_RESERVE", "LUNA_CLOSURE", "TEST_VALIDATION"].includes(metadata.lane);
}

export function validateLaneMetadata(metadata, { action = "" } = {}) {
  if (metadata.origin !== "AGENT") {
    if (metadata.lane && !["AGENT", "OWNER"].includes(metadata.origin)) {
      return [
        "WORK_ORIGIN must be AGENT or explicit OWNER when AGENT_LANE is present",
      ];
    }
    return [];
  }

  const errors = [];
  if (!ALLOWED.lane.has(metadata.lane)) errors.push("AGENT_LANE is missing or invalid");
  if (!ALLOWED.state.has(metadata.state)) errors.push("LANE_STATE is missing or invalid");
  if (!ALLOWED.boolean.has(metadata.activeCandidate)) errors.push("ACTIVE_CANDIDATE must be true or false");
  if (!/^[0-5]$/.test(metadata.closeability)) errors.push("CLOSEABILITY_SCORE must be 0..5");
  if (!ALLOWED.reason.has(metadata.selectionReason)) errors.push("SELECTION_REASON is missing or invalid");
  if (isPlaceholder(metadata.remainingSteps)) errors.push("REMAINING_AUTONOMOUS_STEPS is required");
  if (isPlaceholder(metadata.blocker)) errors.push("OWNER_OR_EXTERNAL_BLOCKER is required; use none when absent");
  if (!ALLOWED.boolean.has(metadata.testLaneRequired)) errors.push("TEST_LANE_REQUIRED must be true or false");
  if (isPlaceholder(metadata.requestedModel)) errors.push("REQUESTED_MODEL / ACTUAL_MODEL is required");

  if (metadata.state === "ACTIVE" && isBplusDeliveryLane(metadata)) {
    if (metadata.bplusMode !== "TRUE") errors.push("An active B+ delivery lane must set BPLUS_MODE=true");
    if (isPlaceholder(metadata.runId)) {
      errors.push("An active B+ delivery lane must declare RUN_ID");
    } else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(metadata.runId)) {
      errors.push("RUN_ID must look like YYYY-MM-DD-name");
    }
    if (isPlaceholder(metadata.scorecardPath)) {
      errors.push("An active B+ delivery lane must declare SCORECARD_PATH");
    } else if (metadata.scorecardPath !== `docs/metrics/agent-runs/${metadata.runId}.json`) {
      errors.push("SCORECARD_PATH must be docs/metrics/agent-runs/<RUN_ID>.json");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TERRA_BUILD") {
    if (!metadata.issueNumber) errors.push("An active TERRA_BUILD must declare pr-lifecycle issue: <number>");
    if (metadata.activeCandidate !== "TRUE") errors.push("An active TERRA_BUILD must set ACTIVE_CANDIDATE=true");
    if (isPlaceholder(metadata.closureTarget)) {
      errors.push("An active TERRA_BUILD must name a LUNA_CLOSURE target, EMPTY_WITH_SCAN, or REPORT:<path>");
    }
    if (metadata.selectionReason === "CLOSE_READY" && Number(metadata.closeability) < 3) {
      errors.push("CLOSE_READY requires CLOSEABILITY_SCORE 3 or higher");
    }
    if (
      metadata.selectionReason !== "CLOSE_READY" &&
      (isPlaceholder(metadata.whyNotCloser) || /^none$/i.test(metadata.whyNotCloser))
    ) {
      errors.push("Non-CLOSE_READY Terra selection requires WHY_NOT_CLOSER_CANDIDATE");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TERRA_RESERVE") {
    if (!metadata.issueNumber) errors.push("An active TERRA_RESERVE must declare pr-lifecycle issue: <number>");
    if (metadata.activeCandidate !== "FALSE") errors.push("TERRA_RESERVE must set ACTIVE_CANDIDATE=false");
    if (metadata.testLaneRequired !== "FALSE") errors.push("TERRA_RESERVE must set TEST_LANE_REQUIRED=false");
    if (isPlaceholder(metadata.reserveBoundary) || /^none$/i.test(metadata.reserveBoundary)) {
      errors.push("TERRA_RESERVE must declare a concrete RESERVE_BOUNDARY");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "LUNA_CLOSURE") {
    if (metadata.activeCandidate !== "TRUE") errors.push("An active LUNA_CLOSURE must set ACTIVE_CANDIDATE=true");
    if (Number(metadata.closeability) < 3) errors.push("An active LUNA_CLOSURE must have CLOSEABILITY_SCORE 3 or higher");
    if (metadata.testLaneRequired !== "FALSE") errors.push("LUNA_CLOSURE must set TEST_LANE_REQUIRED=false");
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TEST_VALIDATION") {
    if (metadata.activeCandidate !== "FALSE") errors.push("TEST_VALIDATION must set ACTIVE_CANDIDATE=false");
    if (metadata.testLaneRequired !== "TRUE") errors.push("An active TEST_VALIDATION lane must set TEST_LANE_REQUIRED=true");
  }

  if (metadata.state === "PARKED") {
    if (metadata.activeCandidate === "TRUE") errors.push("A PARKED PR cannot be an active candidate");
    if (action === "synchronize") {
      errors.push("A PARKED PR received a new commit; reactivate it through Sol TRIAGE before pushing");
    }
  }

  return errors;
}

export function summarizeActiveLanes(pullRequests = []) {
  const activeAgentPulls = pullRequests
    .filter((pr) => pr.state === undefined || pr.state === "open")
    .map(parseLaneMetadata)
    .filter((metadata) => metadata.origin === "AGENT" && metadata.state === "ACTIVE");

  return {
    activeAgentPulls,
    activeTerra: activeAgentPulls.filter((pr) => pr.lane === "TERRA_BUILD"),
    activeReserve: activeAgentPulls.filter((pr) => pr.lane === "TERRA_RESERVE"),
    activeClosure: activeAgentPulls.filter((pr) => pr.lane === "LUNA_CLOSURE"),
    activeTest: activeAgentPulls.filter((pr) => pr.lane === "TEST_VALIDATION"),
    activeCandidates: activeAgentPulls.filter((pr) => pr.activeCandidate === "TRUE"),
  };
}

export function validateGlobalWip(summary) {
  const errors = [];
  const { activeTerra, activeReserve, activeClosure, activeTest, activeCandidates } = summary;

  if (activeTerra.length > 1) {
    errors.push(`active TERRA_BUILD count is ${activeTerra.length}; max is 1 (${activeTerra.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeReserve.length > 1) {
    errors.push(`active TERRA_RESERVE count is ${activeReserve.length}; max is 1 (${activeReserve.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeClosure.length > 1) {
    errors.push(`active LUNA_CLOSURE count is ${activeClosure.length}; max is 1 (${activeClosure.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeTest.length > 1) {
    errors.push(`active TEST_VALIDATION count is ${activeTest.length}; max is 1 (${activeTest.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeCandidates.length > MAX_ACTIVE_CANDIDATES) {
    errors.push(`ACTIVE_CANDIDATE count is ${activeCandidates.length}; max is ${MAX_ACTIVE_CANDIDATES} (${activeCandidates.map((pr) => `#${pr.number}`).join(", ")})`);
  }

  if (activeReserve.length === 1) {
    if (activeTerra.length !== 1) errors.push("TERRA_RESERVE requires exactly one active MAIN TERRA_BUILD");
    if (activeTerra.length === 1 && activeReserve[0].issueNumber === activeTerra[0].issueNumber) {
      errors.push(`TERRA_RESERVE and TERRA_BUILD cannot own the same Issue #${activeTerra[0].issueNumber}`);
    }
  }

  if (activeTerra.length === 1) {
    const target = activeTerra[0].closureTarget.trim();
    const externalEvidence = /^EMPTY_WITH_SCAN$/i.test(target) || /^REPORT:/i.test(target);
    if (!externalEvidence && activeClosure.length !== 1) {
      errors.push(`an active TERRA_BUILD requires one active LUNA_CLOSURE or explicit EMPTY_WITH_SCAN/REPORT evidence; found ${activeClosure.length}`);
    }
  }

  return errors;
}

export function isActiveTestValidation(metadata) {
  return metadata.origin === "AGENT" &&
    metadata.lane === "TEST_VALIDATION" &&
    metadata.state === "ACTIVE" &&
    metadata.bplusMode === "TRUE" &&
    metadata.testLaneRequired === "TRUE";
}

export function findActiveTestLaneHolders(pullRequests = []) {
  return pullRequests
    .filter((pr) => pr.state === undefined || pr.state === "open")
    .map(parseLaneMetadata)
    .filter(isActiveTestValidation)
    .sort((a, b) => a.number - b.number);
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^(?!0{40}$)[0-9a-f]{40}$/i.test(value);
}

export function decideTestValidation({
  eventName,
  ref,
  sha,
  docsOnly = false,
  currentPullRequest = null,
  openPullRequests = [],
  inputs = {},
  currentCommit = null,
  repoFullName = "",
} = {}) {
  const holders = findActiveTestLaneHolders(openPullRequests);
  const holderNumbers = holders.map((holder) => holder.number);
  const result = (runTestValidation, reason, error = null) => ({
    runTestValidation,
    reason,
    error,
    holders: holderNumbers,
  });

  if (eventName === "workflow_dispatch") {
    const dispatchReason = String(inputs.dispatch_reason ?? "").trim();
    const expectedHead = String(inputs.expected_head ?? "").trim();
    const baseRevision = String(inputs.base_revision ?? "").trim();
    const requestedPr = String(inputs.test_lane_pr ?? "").trim();

    // A dispatch can take the docs-only route, but it is still an authenticated
    // request to compare a particular candidate. Validate that contract before
    // deciding whether heavy TEST is necessary.
    if (!isFullCommitSha(expectedHead) || !isFullCommitSha(baseRevision) || !isFullCommitSha(String(sha ?? ""))) {
      return result(false, "invalid_dispatch_revision", "Dispatch base_revision, expected_head and context SHA must be complete non-zero commit SHAs");
    }
    if (expectedHead !== sha) {
      return result(false, "invalid_dispatch_expected_head", `expected_head must equal dispatched SHA ${sha}`);
    }

    if (ref === "refs/heads/main") {
      if (dispatchReason !== "main_manual") {
        return result(false, "invalid_main_dispatch_reason", "A main dispatch must use main_manual");
      }
      if (requestedPr) {
        return result(false, "invalid_main_dispatch_pr", "A main_manual dispatch must not name a TEST lane PR");
      }
      const parents = Array.isArray(currentCommit?.parents) ? currentCommit.parents : [];
      const firstParent = parents[0];
      const firstParentSha = typeof firstParent === "string" ? firstParent : firstParent?.sha;
      if (currentCommit?.sha !== expectedHead || firstParentSha !== baseRevision) {
        return result(false, "invalid_main_dispatch_base", "base_revision must be the authenticated first parent of the dispatched main head");
      }
      return docsOnly
        ? result(false, "docs_only")
        : result(true, "manual_main_exact_head");
    }

    if (dispatchReason !== "lane_transition") {
      return result(false, "invalid_branch_dispatch_reason", "A branch dispatch is allowed only for lane_transition");
    }
    if (!String(ref ?? "").startsWith("refs/heads/")) {
      return result(false, "invalid_branch_dispatch_ref", "A lane_transition dispatch must target a branch ref");
    }
    if (!/^\d+$/.test(requestedPr) || Number(requestedPr) < 1) {
      return result(false, "invalid_dispatch_pr_number", "A branch dispatch requires an open PR number");
    }

    const prNumber = Number(requestedPr);
    const pr = currentPullRequest ?? {};
    const branch = String(ref).slice("refs/heads/".length);
    const metadata = parseLaneMetadata(pr);
    const validPr = pr.number === prNumber &&
      pr.state === "open" &&
      pr.head?.ref === branch &&
      pr.head?.sha === expectedHead &&
      pr.head?.repo?.full_name === repoFullName &&
      pr.base?.sha === baseRevision &&
      isActiveTestValidation(metadata);
    if (!validPr) {
      return result(false, "invalid_dispatch_pr_contract", "The PR/repository/ref/base/head does not match an open active TEST_VALIDATION candidate");
    }
    if (holders.length !== 1 || holders[0].number !== prNumber) {
      return result(false, `invalid_dispatch_test_lane_${holders.length}`,
        `PR #${prNumber} is not the sole TEST_VALIDATION holder (holders: ${holderNumbers.join(",") || "none"})`);
    }
    return docsOnly
      ? result(false, "docs_only")
      : result(true, "validated_lane_transition_exact_head");
  }

  if (docsOnly) return result(false, "docs_only");
  if (eventName === "push" && ref === "refs/heads/main") return result(true, "main_push");

  if (eventName === "pull_request") {
    const metadata = parseLaneMetadata(currentPullRequest ?? {});
    const requestsTest = metadata.origin === "AGENT" &&
      metadata.lane === "TEST_VALIDATION" && metadata.state === "ACTIVE";
    if (!requestsTest) return result(false, "source_only_pr_without_test_lane");

    const errors = validateLaneMetadata(metadata);
    if (errors.length || !isActiveTestValidation(metadata)) {
      return result(false, "invalid_test_lane_metadata", errors.join("; ") || "TEST lane metadata is invalid");
    }
    if (holders.length === 1 && holders[0].number === metadata.number) {
      return result(true, "sole_active_test_validation_lane");
    }
    return result(false, `test_lane_conflict_${holders.length}`,
      `PR #${metadata.number} is not the sole TEST_VALIDATION holder (holders: ${holderNumbers.join(",") || "none"})`);
  }

  return result(false, "unsupported_event_fail_closed", `Unsupported CI event: ${eventName || "unknown"}`);
}

export function requiredFieldNames() {
  return [...FIELD_NAMES];
}
