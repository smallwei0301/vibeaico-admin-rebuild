import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as truth from "../../scripts/agents/completion-truth.mjs";

import {
  classifyEvidenceSinkError,
  completionRefreshSha,
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
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  head_sha: "source-sha",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.example/run/123",
}];

const mainRuns = [{
  id: 456,
  name: "ci",
  path: ".github/workflows/ci.yml",
  event: "push",
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
        id: 9, name: "ci", path: ".github/workflows/ci.yml", event: "push", head_sha: "merge-sha", status: "completed", conclusion: "cancelled",
      }], "merge-sha")).toMatchObject({ state: "CANCELLED", verified: false });
    });

    it("只有 success 才算通過；還在跑是 PENDING、沒有 run 是 NOT_REPORTED", () => {
      expect(classifyMainCiAfterMerge(mainRuns, "merge-sha")).toMatchObject({ state: "VERIFIED", verified: true });
      expect(classifyMainCiAfterMerge([{
        id: 9, name: "ci", path: ".github/workflows/ci.yml", event: "push", head_sha: "merge-sha", status: "in_progress", conclusion: null,
      }], "merge-sha")).toMatchObject({ state: "PENDING", verified: false });
      expect(classifyMainCiAfterMerge([], "merge-sha")).toMatchObject({ state: "NOT_REPORTED", verified: false });
      expect(classifyMainCiAfterMerge(mainRuns, "")).toMatchObject({ state: "NOT_REPORTED", verified: false });
    });

    it("不拿別的 workflow 或別顆 commit 的 run 充數", () => {
      expect(classifyMainCiAfterMerge([{
        id: 9, name: "agent-wip-guard", head_sha: "merge-sha", status: "completed", conclusion: "success",
      }, {
        id: 10, name: "ci", path: ".github/workflows/ci.yml", event: "push", head_sha: "other-sha", status: "completed", conclusion: "success",
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
          id: 456, name: "ci", path: ".github/workflows/ci.yml", event: "push", head_sha: "merge-sha", status: "completed", conclusion: "failure",
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
          id: 456, name: "ci", path: ".github/workflows/ci.yml", event: "push", head_sha: "merge-sha", status: "completed", conclusion: "cancelled",
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

function evaluateRuns(source = sourceRuns, main = mainRuns) {
  return evaluateProductDeliveryTruth({
    pullRequest: mergedPullRequest({ body: productBody }),
    defaultBranchHead: "main-sha", compareStatus: "ahead",
    changedFiles: [{ filename: "src/app/page.tsx" }],
    sourceWorkflowRuns: source, mainWorkflowRuns: main, commitStatuses: readyVercel,
  });
}

describe("CI evidence classes (#692)", () => {
  it("keeps manual TEST/G3 separate from source PR and main push evidence", () => {
    const source = [sourceRuns[0], { ...sourceRuns[0], id: 999, event: "workflow_dispatch", conclusion: "cancelled" }];
    const main = [mainRuns[0], { ...mainRuns[0], id: 1000, event: "workflow_dispatch", status: "in_progress" }];
    const result = evaluateRuns(source, main);
    expect(result.source).toMatchObject({ state: "VERIFIED", runId: 123, event: "pull_request" });
    expect(result.mainCi).toMatchObject({ state: "VERIFIED", runId: 456, event: "push" });
    expect(evaluateRuns(source.filter(r => r.id === 999), main.filter(r => r.id === 1000)))
      .toMatchObject({ source: { state: "NOT_REPORTED" }, mainCi: { state: "NOT_REPORTED" }, productionAccepted: false });
  });

  it.each(["failure", "cancelled", "timed_out", "startup_failure"])("does not hide newer same-class %s behind older green", conclusion => {
    const result = evaluateRuns(
      [sourceRuns[0], { ...sourceRuns[0], id: 1001, conclusion }],
      [mainRuns[0], { ...mainRuns[0], id: 1002, conclusion }],
    );
    expect(result.source).toMatchObject({ state: conclusion.toUpperCase(), verified: false, runId: 1001 });
    expect(result.mainCi).toMatchObject({ state: conclusion.toUpperCase(), verified: false, runId: 1002 });
    expect(result.productionAccepted).toBe(false);
  });

  it("uses the latest attempt of a run, in either input order, including a pending rerun", () => {
    for (const status of ["completed", "in_progress"]) {
      const attempts = [
        { ...mainRuns[0], run_attempt: 1 },
        { ...mainRuns[0], run_attempt: 2, status, conclusion: "failure" },
      ];
      for (const runs of [attempts, [...attempts].reverse()]) {
        expect(classifyMainCiAfterMerge(runs, "merge-sha")).toMatchObject({
          verified: false, runAttempt: 2, state: status === "completed" ? "FAILURE" : "PENDING",
        });
      }
    }
    const sourceAttempts = [{ ...sourceRuns[0], run_attempt: 2, conclusion: "cancelled" }, { ...sourceRuns[0], run_attempt: 1 }];
    expect(evaluateRuns(sourceAttempts).source).toMatchObject({ verified: false, runAttempt: 2, state: "CANCELLED" });
    expect(classifyMainCiAfterMerge([
      { ...mainRuns[0], run_attempt: 9 }, { ...mainRuns[0], id: 457, run_attempt: 1, conclusion: "failure" },
    ], "merge-sha")).toMatchObject({ runId: 457, verified: false });
  });

  it.each([
    { path: ".github/workflows/impostor.yml" }, { path: "" },
    { head_sha: "wrong-sha" }, { event: "workflow_dispatch" }, { event: "pull_request_target" },
  ])("rejects wrong or incomplete workflow/SHA/event identity: %j", override => {
    expect(evaluateRuns([{ ...sourceRuns[0], ...override }], [{ ...mainRuns[0], ...override }]))
      .toMatchObject({ source: { state: "NOT_REPORTED" }, mainCi: { state: "NOT_REPORTED" }, productionAccepted: false });
  });

  it("uses canonical path rather than a mutable display name", () => {
    expect(evaluateRuns([{ ...sourceRuns[0], name: "Renamed CI" }]).source.verified).toBe(true);
  });

  it("correct source/main truth still cannot ship #691 without schema and authenticated acceptance", () => {
    const result = evaluateProductDeliveryTruth({
      pullRequest: mergedPullRequest({ body: productBody
        .replace("PRODUCTION_SCHEMA_STATUS: NOT_REQUIRED", "PRODUCTION_SCHEMA_STATUS: NOT_APPLIED")
        .replace("AUTHENTICATED_PRODUCTION_ACCEPTANCE: VERIFIED", "AUTHENTICATED_PRODUCTION_ACCEPTANCE: NOT_RUN") }),
      defaultBranchHead: "merge-sha", compareStatus: "identical",
      changedFiles: [{ filename: "src/app/page.tsx" }], sourceWorkflowRuns: sourceRuns,
      mainWorkflowRuns: mainRuns, commitStatuses: readyVercel,
    });
    expect(result).toMatchObject({ source: { verified: true }, mainCi: { verified: true },
      schema: { ready: false }, acceptance: { accepted: false }, productionAccepted: false });
  });
});

const repository = { id: 1340655090, default_branch: "main" };
const completedRun = {
  id: 42, workflow_id: 7, path: ".github/workflows/ci.yml", status: "completed",
  repository, head_repository: repository, head_sha: "a".repeat(40), event: "push", head_branch: "main",
};

describe("trusted CI completion refresh", () => {
  it("resolves the triggering SHA for completed main push or source PR, regardless of conclusion", () => {
    expect(completionRefreshSha(completedRun, repository, 7)).toBe(completedRun.head_sha);
    expect(completionRefreshSha({ ...completedRun, event: "pull_request", head_branch: "feature", conclusion: "failure" }, repository, 7))
      .toBe(completedRun.head_sha);
  });
  it.each([
    { workflow_id: 8 }, { path: ".github/workflows/other.yml" }, { repository: { id: 2 } },
    { head_repository: { id: 2 } }, { head_repository: null }, { event: "workflow_dispatch" },
    { event: "pull_request_target" }, { head_branch: "feature" }, { status: "in_progress" }, { head_sha: "" },
  ])("rejects untrusted or irrelevant wake-up %j", override => {
    expect(completionRefreshSha({ ...completedRun, ...override }, repository, 7)).toBeNull();
  });
  it("fails closed on missing identity", () => {
    expect(completionRefreshSha(completedRun, {}, 7)).toBeNull();
    expect(completionRefreshSha(completedRun, repository, undefined)).toBeNull();
  });
});


describe("CI completion workflow wiring", () => {
  const workflow = readFileSync(".github/workflows/agent-completion-truth.yml", "utf8");
  const script = workflow.split("          script: |\n")[1].split("\n")
    .map(line => line.slice(12)).join("\n")
    .replace(/const path = require[\s\S]*?\)\.href\);/, "");
  const execute = new Function("github", "context", "core", "truth", `return (async () => {${script}})()`);

  it("checks out trusted default branch with no persisted credentials or trigger artifacts", () => {
    expect(workflow).toContain("workflows: [ci]\n    types: [completed]");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toMatch(/ref:.*head_sha|download-artifact/);
  });

  it.each(["push", "pull_request"])("refreshes a merged PR from completed %s using live run SHA rather than workflow SHA", async event => {
    const run = { ...completedRun, event, head_branch: event === "push" ? "main" : "feature" };
    const pr = mergedPullRequest({
      body: productBody, head: { sha: event === "pull_request" ? run.head_sha : "source-sha" },
      merge_commit_sha: event === "push" ? run.head_sha : "merge-sha",
      base: { ref: "main", repo: repository },
    });
    const summary = { addHeading: vi.fn().mockReturnThis(), addRaw: vi.fn().mockReturnThis(),
      addTable: vi.fn().mockReturnThis(), addList: vi.fn().mockReturnThis(), write: vi.fn() };
    const core = { summary, notice: vi.fn(), warning: vi.fn(), setFailed: vi.fn() };
    const associated = vi.fn(); const runs = vi.fn(); const files = vi.fn(); const comments = vi.fn();
    const createComment = vi.fn();
    const github = {
      rest: {
        repos: { getBranch: vi.fn().mockResolvedValue({ data: { commit: { sha: pr.merge_commit_sha } } }),
          listPullRequestsAssociatedWithCommit: associated,
          getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { statuses: [] } }) },
        actions: { getWorkflowRun: vi.fn().mockResolvedValue({ data: run }),
          getWorkflow: vi.fn().mockResolvedValue({ data: { id: 7 } }), listWorkflowRuns: runs },
        pulls: { get: vi.fn().mockResolvedValue({ data: pr }), listFiles: files },
        issues: { listComments: comments, createComment },
      },
      paginate: vi.fn(async (method: unknown, args: Record<string, unknown>) => {
        if (method === associated) { expect(args.commit_sha).toBe(run.head_sha); return [{ number: pr.number }]; }
        if (method === files) return [{ filename: "src/app/page.tsx" }];
        if (method === runs) {
          expect(args.workflow_id).toBe(".github/workflows/ci.yml");
          return args.event === "pull_request"
            ? [{ ...sourceRuns[0], head_sha: pr.head.sha }]
            : [{ ...mainRuns[0], head_sha: pr.merge_commit_sha }];
        }
        return [];
      }),
    };
    const context = { repo: { owner: "smallwei0301", repo: "vibeaico-admin-rebuild" },
      eventName: "workflow_run", sha: "wrong-workflow-default-sha", payload: { repository, workflow_run: { id: 42 } } };
    await execute(github, context, core, truth);
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0][0].body).toContain("MAIN_CI_AFTER_MERGE: VERIFIED");
    expect(core.setFailed).not.toHaveBeenCalled();

    // Neither an associated but different SHA, unmerged PR nor a different base may be written.
    for (const changes of [{ head: { sha: "other" }, merge_commit_sha: "other" },
      { merged_at: null }, { base: { ref: "other", repo: repository } },
      { base: { ref: "main", repo: { id: 2 } } }]) {
      createComment.mockClear();
      github.rest.pulls.get.mockResolvedValue({ data: { ...pr, ...changes } });
      await execute(github, context, core, truth);
      expect(createComment).not.toHaveBeenCalled();
    }
    // The live run identity is authoritative even when the event payload passed the job filter.
    github.rest.actions.getWorkflowRun.mockResolvedValue({ data: { ...run, head_repository: { id: 2 } } });
    github.paginate.mockClear();
    await execute(github, context, core, truth);
    expect(github.paginate).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });
});
