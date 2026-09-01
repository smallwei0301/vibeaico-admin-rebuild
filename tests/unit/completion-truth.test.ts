import { describe, expect, it } from "vitest";

import {
  evaluateMergedPullRequest,
  formatCompletionTruth,
} from "../../scripts/agents/completion-truth.mjs";

function mergedPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 97,
    state: "closed",
    merged: true,
    merged_at: "2026-09-01T08:00:00Z",
    merge_commit_sha: "merge-sha",
    ...overrides,
  };
}

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
});
