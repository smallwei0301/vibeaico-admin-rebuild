#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const LIFECYCLE_RE = /<!--\s*pr-lifecycle\s*([\s\S]*?)-->/i;
const ALLOWED_STATES = new Set([
  "ACTIVE",
  "VALIDATION",
  "REBUILD_REQUIRED",
  "OWNER_GATED",
]);

export function parseLifecycleMetadata(body = "") {
  const match = body.match(LIFECYCLE_RE);
  if (!match) return null;

  const values = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    values[key] = value;
  }

  const issue = /^\d+$/.test(values.issue ?? "") ? Number(values.issue) : null;
  const state = (values.state ?? "").toUpperCase();
  const supersedes = (values.supersedes ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^#/, ""))
    .filter((value) => /^\d+$/.test(value))
    .map(Number);

  return {
    issue,
    state: ALLOWED_STATES.has(state) ? state : null,
    supersedes: [...new Set(supersedes)],
    explicit: true,
  };
}

export function inferIssueNumber(pr) {
  const metadata = parseLifecycleMetadata(pr.body ?? "");
  if (metadata?.issue) return metadata.issue;

  const haystacks = [pr.title ?? "", pr.body ?? "", pr.head?.ref ?? ""];
  const candidates = new Set();
  const patterns = [
    /(?:issue|fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?)[\s:()_-]*#?(\d+)/gi,
    /(?:^|[^\w])#(\d+)(?:\b|$)/g,
    /issue[-_/](\d+)(?:\b|[-_/])/gi,
  ];

  for (const haystack of haystacks) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of haystack.matchAll(pattern)) {
        candidates.add(Number(match[1]));
      }
    }
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

export function classifyPr(pr) {
  const metadata = parseLifecycleMetadata(pr.body ?? "");
  return {
    number: pr.number,
    issue: inferIssueNumber(pr),
    state: metadata?.state ?? "UNCLASSIFIED",
    supersedes: metadata?.supersedes ?? [],
    explicit: Boolean(metadata),
  };
}

export function evaluateDeclaredSupersession({ source, target, compareStatus }) {
  const sourceMeta = parseLifecycleMetadata(source.body ?? "");
  if (!sourceMeta) return { safe: false, reason: "SOURCE_METADATA_MISSING" };
  if (sourceMeta.state !== "ACTIVE") {
    return { safe: false, reason: "SOURCE_NOT_ACTIVE" };
  }
  if (!sourceMeta.supersedes.includes(target.number)) {
    return { safe: false, reason: "TARGET_NOT_DECLARED" };
  }

  const sourceIssue = inferIssueNumber(source);
  const targetIssue = inferIssueNumber(target);
  if (!sourceIssue || !targetIssue || sourceIssue !== targetIssue) {
    return { safe: false, reason: "ISSUE_MISMATCH_OR_UNKNOWN" };
  }
  if (target.state !== "open") {
    return { safe: false, reason: "TARGET_NOT_OPEN" };
  }
  if (!source.head?.sha || !target.head?.sha) {
    return { safe: false, reason: "HEAD_SHA_MISSING" };
  }
  if (!new Set(["ahead", "identical"]).has(compareStatus)) {
    return { safe: false, reason: `ANCESTRY_${String(compareStatus).toUpperCase()}` };
  }

  return { safe: true, reason: "DECLARED_AND_ANCESTRY_PROVEN" };
}

export function findBudgetViolations(prs) {
  const byIssue = new Map();
  for (const pr of prs) {
    if (pr.state !== "open") continue;
    const row = classifyPr(pr);
    if (!row.issue) continue;
    if (!byIssue.has(row.issue)) byIssue.set(row.issue, []);
    byIssue.get(row.issue).push(row);
  }

  const violations = [];
  for (const [issue, rows] of byIssue.entries()) {
    const active = rows.filter((row) => row.state === "ACTIVE");
    const validation = rows.filter((row) => row.state === "VALIDATION");
    if (rows.length > 2 || active.length > 1 || validation.length > 1) {
      violations.push({ issue, rows, active, validation });
    }
  }
  return violations.sort((a, b) => a.issue - b.issue);
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
  };
}

function githubContext() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY must be set to owner/repo");
  }
  const [owner, repo] = repository.split("/");
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    token: process.env.GITHUB_TOKEN ?? "",
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
  };
}

async function api(context, path, options = {}) {
  const response = await fetch(`${context.apiUrl}/repos/${context.owner}/${context.repo}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function paginate(context, path) {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const pageRows = await api(context, `${path}${separator}per_page=100&page=${page}`);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function compareHeads(context, oldSha, newSha) {
  const result = await api(context, `/compare/${encodeURIComponent(oldSha)}...${encodeURIComponent(newSha)}`);
  return result.status;
}

async function upsertJanitorComment(context, prNumber, body) {
  const marker = "<!-- pr-janitor-summary -->";
  const comments = await paginate(context, `/issues/${prNumber}/comments?`);
  const existing = comments.find((comment) => (comment.body ?? "").includes(marker));
  const payload = { body: `${marker}\n${body}` };
  if (existing) {
    await api(context, `/issues/comments/${existing.id}`, { method: "PATCH", body: payload });
  } else {
    await api(context, `/issues/${prNumber}/comments`, { method: "POST", body: payload });
  }
}

async function addSupersededComment(context, oldPrNumber, newPrNumber) {
  const marker = `<!-- pr-janitor-superseded-by:${newPrNumber} -->`;
  const comments = await paginate(context, `/issues/${oldPrNumber}/comments?`);
  if (comments.some((comment) => (comment.body ?? "").includes(marker))) return;

  await api(context, `/issues/${oldPrNumber}/comments`, {
    method: "POST",
    body: {
      body: `${marker}\nSuperseded by PR #${newPrNumber}. Commit ancestry proves the new ACTIVE candidate contains this PR head. This PR is no longer a merge or acceptance candidate; its history remains available here.`,
    },
  });
}

async function closePr(context, number) {
  await api(context, `/pulls/${number}`, { method: "PATCH", body: { state: "closed" } });
}

function readTriggerPrNumber() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return event.pull_request?.number ?? null;
  } catch {
    return null;
  }
}

function renderSummary({ apply, actions, reviews, violations }) {
  const lines = [
    `PR Janitor mode: **${apply ? "APPLY" : "DRY_RUN"}**`,
    "",
    `- safely superseded/closed: ${actions.length}`,
    `- needs JANITOR_REVIEW: ${reviews.length}`,
    `- PR budget violations: ${violations.length}`,
  ];

  if (actions.length) {
    lines.push("", "### Closed safely");
    for (const action of actions) {
      lines.push(`- #${action.target} → superseded by #${action.source} (${action.reason})`);
    }
  }

  if (reviews.length) {
    lines.push("", "### JANITOR_REVIEW");
    for (const review of reviews) {
      lines.push(`- #${review.target} declared by #${review.source}: ${review.reason}`);
    }
  }

  if (violations.length) {
    lines.push("", "### PR budget");
    for (const violation of violations) {
      lines.push(
        `- Issue #${violation.issue}: ${violation.rows
          .map((row) => `#${row.number}(${row.state})`)
          .join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

export async function runJanitor({ apply = false } = {}) {
  const context = githubContext();
  if (apply && !context.token) throw new Error("--apply requires GITHUB_TOKEN");

  const openPrs = await paginate(context, "/pulls?state=open&sort=updated&direction=desc&");
  const byNumber = new Map(openPrs.map((pr) => [pr.number, pr]));
  const actions = [];
  const reviews = [];
  const closedNumbers = new Set();

  for (const source of openPrs) {
    const sourceMeta = parseLifecycleMetadata(source.body ?? "");
    if (sourceMeta?.state !== "ACTIVE" || sourceMeta.supersedes.length === 0) continue;

    if (source.head?.repo?.full_name !== context.fullName) {
      for (const targetNumber of sourceMeta.supersedes) {
        reviews.push({ source: source.number, target: targetNumber, reason: "SOURCE_NOT_SAME_REPOSITORY" });
      }
      continue;
    }

    for (const targetNumber of sourceMeta.supersedes) {
      const target = byNumber.get(targetNumber);
      if (!target) continue;

      let compareStatus = "unknown";
      try {
        compareStatus = await compareHeads(context, target.head.sha, source.head.sha);
      } catch (error) {
        reviews.push({ source: source.number, target: targetNumber, reason: `COMPARE_FAILED: ${error.message}` });
        continue;
      }

      const decision = evaluateDeclaredSupersession({ source, target, compareStatus });
      if (!decision.safe) {
        reviews.push({ source: source.number, target: targetNumber, reason: decision.reason });
        continue;
      }

      actions.push({ source: source.number, target: targetNumber, reason: decision.reason });
      closedNumbers.add(targetNumber);
      if (apply) {
        await addSupersededComment(context, targetNumber, source.number);
        await closePr(context, targetNumber);
      }
    }
  }

  const remainingOpen = openPrs.filter((pr) => !closedNumbers.has(pr.number));
  const violations = findBudgetViolations(remainingOpen);
  const summary = renderSummary({ apply, actions, reviews, violations });
  console.log(summary);

  const triggerPr = readTriggerPrNumber();
  if (apply && triggerPr) {
    await upsertJanitorComment(context, triggerPr, summary);
  }

  return { actions, reviews, violations, summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runJanitor({ apply: args.apply && !args.dryRun });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    console.error(`[pr-janitor] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
