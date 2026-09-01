const REACHABLE_STATUSES = new Set(["ahead", "identical"]);

export function evaluateMergedPullRequest({
  pullRequest,
  defaultBranchHead,
  compareStatus,
} = {}) {
  const errors = [];
  const pr = pullRequest ?? {};
  const mergeCommitSha = String(pr.merge_commit_sha ?? "").trim();
  const mergedAt = String(pr.merged_at ?? "").trim();
  const mainHead = String(defaultBranchHead ?? "").trim();
  const normalizedCompare = String(compareStatus ?? "").trim().toLowerCase();

  if (!Number.isInteger(Number(pr.number)) || Number(pr.number) < 1) {
    errors.push("pull request number is missing or invalid");
  }
  if (pr.state !== "closed") errors.push("pull request is not closed");
  if (!mergedAt && pr.merged !== true) errors.push("pull request is not marked merged");
  if (!mergeCommitSha) errors.push("merge_commit_sha is missing");
  if (!mainHead) errors.push("default branch head is missing");
  if (!REACHABLE_STATUSES.has(normalizedCompare)) {
    errors.push("merge commit is not verified as reachable from the default branch head");
  }

  return {
    verified: errors.length === 0,
    errors,
    pullRequestNumber: Number(pr.number) || null,
    mergedAt: mergedAt || null,
    mergeCommitSha: mergeCommitSha || null,
    defaultBranchHead: mainHead || null,
    compareStatus: normalizedCompare || null,
  };
}

export function formatCompletionTruth(result, verifiedAt = new Date().toISOString()) {
  const status = result.verified ? "VERIFIED_MERGED" : "MERGE_UNVERIFIED";
  const errors = result.errors.length ? result.errors.map((error) => `- ${error}`).join("\n") : "- none";

  return [
    "<!-- agent-completion-truth -->",
    "## Completion Truth Gate",
    "",
    `- STATUS: ${status}`,
    `- PR: ${result.pullRequestNumber ? `#${result.pullRequestNumber}` : "unknown"}`,
    `- MERGE_COMMIT_SHA: ${result.mergeCommitSha ?? "unknown"}`,
    `- DEFAULT_BRANCH_HEAD: ${result.defaultBranchHead ?? "unknown"}`,
    `- REACHABILITY: ${result.compareStatus ?? "unknown"}`,
    `- VERIFIED_AT: ${verifiedAt}`,
    "",
    "### Verification errors",
    "",
    errors,
    "",
    result.verified
      ? "This comment is generated from live GitHub state after the merge event."
      : "Do not report this PR as merged until live GitHub evidence satisfies every check.",
  ].join("\n");
}
