import { describe, expect, it } from "vitest";

import {
  classifyEvidenceSinkError,
  classifyMainCiAfterMerge,
  classifyVercelStatus,
  evaluateMergedPullRequest,
  evaluateProductDeliveryTruth,
  formatCompletionTruth,
  formatProductDeliveryTruth,
} from "../../scripts/agents/completion-truth.mjs";

function mergedPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 97,
    state: "closed",
    merged: true,
    merged_at: "2026-09-01T08:00:00Z",
    merge_commit_sha: "merge-sha",
    head: { sha: "source-sha" },
    body: "",
    ...overrides,
  };
}

const productBody = `<!-- pr-lifecycle
issue: 150
state: ACTIVE
supersedes:
-->

- DELIVERY_UNIT_TYPE: SLICE
- COUNT_IN_DELIVERY_OUTCOME: true
- RETROACTIVE_TRACKING_MIGRATION: false
- MANUAL_PRODUCTION_PROMOTE: NOT_RUN
- PRODUCTION_SCHEMA_STATUS: NOT_REQUIRED
- PRODUCTION_SCHEMA_EVIDENCE: none
- AUTHENTICATED_PRODUCTION_ACCEPTANCE: VERIFIED
- AUTHENTICATED_PRODUCTION_EVIDENCE: https://midao.example/evidence/150
`;

const sourceRuns = [{
  id: 123,
  name: "ci",
  head_sha: "source-sha",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.example/run/123",
}];

const mainRuns = [{
  id: 456,
  name: "ci",
  head_sha: "merge-sha",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.example/run/456",
}];

const readyVercel = [{
  context: "Vercel",
  state: "success",
  description: "Deployment has completed",
  target_url: "https://vercel.example/deploy",
  updated_at: "2026-09-03T00:00:00Z",
}];

describe("Completion Truth Gate", () => {
  it("verifies a merged PR only when the merge commit is reachable from main", () => {
    const result = evaluateMergedPullRequest({
      pullRequest: mergedPullRequest(),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
    });

    expect(result).toMatchObject({
      verified: true,
      errors: [],
      pullRequestNumber: 97,
      mergeCommitSha: "merge-sha",
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
    });
    expect(formatCompletionTruth(result, "2026-09-01T08:01:00Z")).toContain("STATUS: VERIFIED_MERGED");
  });

  it("accepts an identical default-branch head", () => {
    const result = evaluateMergedPullRequest({
      pullRequest: mergedPullRequest(),
      defaultBranchHead: "merge-sha",
      compareStatus: "identical",
    });
    expect(result.verified).toBe(true);
  });

  it("does not confuse a requested or merely closed PR with a merge", () => {
    const result = evaluateMergedPullRequest({
      pullRequest: mergedPullRequest({ merged: false, merged_at: null, merge_commit_sha: null }),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
    });

    expect(result.verified).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "pull request is not marked merged",
      "merge_commit_sha is missing",
    ]));
    expect(formatCompletionTruth(result)).toContain("STATUS: MERGE_UNVERIFIED");
  });

  it("fails when the claimed merge commit is not reachable from main", () => {
    const result = evaluateMergedPullRequest({
      pullRequest: mergedPullRequest(),
      defaultBranchHead: "other-main-sha",
      compareStatus: "diverged",
    });

    expect(result.verified).toBe(false);
    expect(result.errors).toContain(
      "merge commit is not verified as reachable from the default branch head",
    );
  });

  it("keeps a verified merge valid when the evidence comment sink returns 403", () => {
    const sinkError = classifyEvidenceSinkError({
      status: 403,
      message: "Resource not accessible by integration",
    });

    expect(sinkError).toEqual({
      status: 403,
      message: "Resource not accessible by integration",
      code: "HTTP_403",
      verificationInvalidated: false,
    });
  });

  it("records an unknown evidence sink failure without turning it into a merge fact failure", () => {
    const sinkError = classifyEvidenceSinkError(new Error("network unavailable"));
    expect(sinkError).toMatchObject({
      status: null,
      code: "UNKNOWN",
      verificationInvalidated: false,
    });
  });

  it("distinguishes a real Vercel deployment from an Ignored Build Step", () => {
    expect(classifyVercelStatus(readyVercel)).toMatchObject({ state: "READY", ready: true });
    expect(classifyVercelStatus([{
      context: "Vercel",
      state: "success",
      description: "Canceled by Ignored Build Step",
    }])).toMatchObject({ state: "CANCELED_IGNORED", ready: false });
  });

  it("reaches authenticated Production acceptance only after every stage is verified", () => {
    const result = evaluateProductDeliveryTruth({
      pullRequest: mergedPullRequest({ body: productBody }),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
      changedFiles: [{ filename: "src/app/page.tsx" }],
      sourceWorkflowRuns: sourceRuns,
      mainWorkflowRuns: mainRuns,
      commitStatuses: readyVercel,
    });

    expect(result).toMatchObject({
      productionAccepted: true,
      deliveryEligible: true,
      migrationTouched: false,
      source: { state: "VERIFIED" },
      mainCi: { state: "VERIFIED" },
      vercel: { state: "READY" },
      schema: { state: "NOT_REQUIRED" },
      acceptance: { state: "ACCEPTED" },
    });
    expect(formatProductDeliveryTruth(result)).toContain("STATUS: AUTHENTICATED_PRODUCTION_ACCEPTED");
  });

  it("does not treat a merged and deployed Product as shipped without authenticated acceptance", () => {
    const result = evaluateProductDeliveryTruth({
      pullRequest: mergedPullRequest({
        body: productBody.replace("AUTHENTICATED_PRODUCTION_ACCEPTANCE: VERIFIED", "AUTHENTICATED_PRODUCTION_ACCEPTANCE: NOT_RUN"),
      }),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
      changedFiles: [{ filename: "src/app/page.tsx" }],
      sourceWorkflowRuns: sourceRuns,
      mainWorkflowRuns: mainRuns,
      commitStatuses: readyVercel,
    });

    expect(result.productionAccepted).toBe(false);
    expect(result.acceptance.state).toBe("NOT_RUN");
    expect(formatProductDeliveryTruth(result)).toContain("STATUS: PRODUCTION_PENDING");
  });

  it("fails closed when an actual migration is declared not required", () => {
    const result = evaluateProductDeliveryTruth({
      pullRequest: mergedPullRequest({ body: productBody }),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
      changedFiles: [{ filename: "supabase/migrations/0074_example.sql" }],
      sourceWorkflowRuns: sourceRuns,
      mainWorkflowRuns: mainRuns,
      commitStatuses: readyVercel,
    });

    expect(result.productionAccepted).toBe(false);
    expect(result.errors).toContain(
      "actual migration files changed but PRODUCTION_SCHEMA_STATUS is NOT_REQUIRED",
    );
  });

  it("warns when legacy no-deploy prose conflicts with live Vercel READY", () => {
    const result = evaluateProductDeliveryTruth({
      pullRequest: mergedPullRequest({ body: `${productBody}\n- Production deploy: NOT_RUN\n` }),
      defaultBranchHead: "main-sha",
      compareStatus: "ahead",
      changedFiles: [{ filename: "src/app/page.tsx" }],
      sourceWorkflowRuns: sourceRuns,
      mainWorkflowRuns: mainRuns,
      commitStatuses: readyVercel,
    });

    expect(result.warnings).toContain(
      "legacy `Production deploy: NOT_RUN` conflicts with live Vercel READY; distinguish automatic deploy from manual promote",
    );
  });

  /*
   * 第六點：合併之後 main 上的 canonical `ci` 真的綠了沒有。
   * 前五點全綠、main 卻連續十五次推送沒有一次 success（其中六次 cancelled），
   * 就是因為沒有任何 gate 看合併後的那顆 commit。
   */
  describe("Completion Truth 第六點：merge commit 上的 main CI", () => {
    it("把 cancelled 當成未知而不是綠燈", () => {
      expect(classifyMainCiAfterMerge([{
        id: 9, name: "ci", head_sha: "merge-sha", status: "completed", conclusion: "cancelled",
      }], "merge-sha")).toMatchObject({ state: "CANCELLED", verified: false });
    });

    it("只有 success 才算通過；還在跑是 PENDING、沒有 run 是 NOT_REPORTED", () => {
      expect(classifyMainCiAfterMerge(mainRuns, "merge-sha")).toMatchObject({ state: "VERIFIED", verified: true });
      expect(classifyMainCiAfterMerge([{
        id: 9, name: "ci", head_sha: "merge-sha", status: "in_progress", conclusion: null,
      }], "merge-sha")).toMatchObject({ state: "PENDING", verified: false });
      expect(classifyMainCiAfterMerge([], "merge-sha")).toMatchObject({ state: "NOT_REPORTED", verified: false });
      expect(classifyMainCiAfterMerge(mainRuns, "")).toMatchObject({ state: "NOT_REPORTED", verified: false });
    });

    it("不拿別的 workflow 或別顆 commit 的 run 充數", () => {
      expect(classifyMainCiAfterMerge([{
        id: 9, name: "agent-wip-guard", head_sha: "merge-sha", status: "completed", conclusion: "success",
      }, {
        id: 10, name: "ci", head_sha: "other-sha", status: "completed", conclusion: "success",
      }], "merge-sha")).toMatchObject({ state: "NOT_REPORTED", verified: false });
    });

    it("main CI 紅燈時擋下 authenticated Production acceptance 並留下警告", () => {
      const result = evaluateProductDeliveryTruth({
        pullRequest: mergedPullRequest({ body: productBody }),
        defaultBranchHead: "main-sha",
        compareStatus: "ahead",
        changedFiles: [{ filename: "src/app/page.tsx" }],
        sourceWorkflowRuns: sourceRuns,
        mainWorkflowRuns: [{
          id: 456, name: "ci", head_sha: "merge-sha", status: "completed", conclusion: "failure",
        }],
        commitStatuses: readyVercel,
      });

      expect(result.productionAccepted).toBe(false);
      expect(result.mainCi.state).toBe("FAILURE");
      expect(result.errors).toContain(
        "authenticated Production acceptance requires a green canonical ci run on the merge commit (main ci is FAILURE)",
      );
      expect(result.warnings).toContain(
        "canonical ci on the merge commit ended as FAILURE; main is not proven green after this merge",
      );
      expect(formatProductDeliveryTruth(result)).toContain("MAIN_CI_AFTER_MERGE: FAILURE");
    });

    it("cancelled 同樣擋下 acceptance，不因為「沒有紅燈」就放行", () => {
      const result = evaluateProductDeliveryTruth({
        pullRequest: mergedPullRequest({ body: productBody }),
        defaultBranchHead: "main-sha",
        compareStatus: "ahead",
        changedFiles: [{ filename: "src/app/page.tsx" }],
        sourceWorkflowRuns: sourceRuns,
        mainWorkflowRuns: [{
          id: 456, name: "ci", head_sha: "merge-sha", status: "completed", conclusion: "cancelled",
        }],
        commitStatuses: readyVercel,
      });

      expect(result.productionAccepted).toBe(false);
      expect(result.errors).toContain(
        "authenticated Production acceptance requires a green canonical ci run on the merge commit (main ci is CANCELLED)",
      );
    });

    it("沒有宣告 acceptance 的 PR 不因為 main CI 尚未回報而被判成錯誤", () => {
      const result = evaluateProductDeliveryTruth({
        pullRequest: mergedPullRequest({
          body: productBody.replace("AUTHENTICATED_PRODUCTION_ACCEPTANCE: VERIFIED", "AUTHENTICATED_PRODUCTION_ACCEPTANCE: NOT_RUN"),
        }),
        defaultBranchHead: "main-sha",
        compareStatus: "ahead",
        changedFiles: [{ filename: "src/app/page.tsx" }],
        sourceWorkflowRuns: sourceRuns,
        mainWorkflowRuns: [],
        commitStatuses: readyVercel,
      });

      expect(result.mainCi.state).toBe("NOT_REPORTED");
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });
});
