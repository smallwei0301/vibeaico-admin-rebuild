import { describe, expect, it } from "vitest";

import {
  gitBlobSha,
  normalizeEvidence,
  reconcileLedger,
  stableStringify,
} from "../../scripts/agents/run-ledger-reconcile.mjs";

const MAIN = "a".repeat(40);
const LEDGER_SHA = "b".repeat(40);

function claim(type = "SOURCE_VERIFIED", subject = "issue#170", state = "success") {
  return {
    type,
    subject,
    claimedState: state,
    observedState: state,
    verification: "VERIFIED",
    evidenceRef: "github:live-evidence",
  };
}

function ledger(deliveryTruthVersion = 3): any {
  return {
    schemaVersion: 2,
    deliveryTruthVersion,
    runId: "2026-09-04-reconcile-test",
    completionTruth: { status: "NOT_CHECKED", checkedAt: null, claims: [] },
  };
}

function evidence(operations: any[], completionTruth: any = undefined): any {
  return {
    schemaVersion: 1,
    runId: "2026-09-04-reconcile-test",
    observedMainSha: MAIN,
    ...(completionTruth ? { completionTruth } : {}),
    operations,
  };
}

function apply(current: any, input: any, expected = LEDGER_SHA) {
  return reconcileLedger({
    ledger: current,
    evidence: input,
    currentMainSha: MAIN,
    currentLedgerSha: LEDGER_SHA,
    expectedLedgerSha: expected,
  });
}

describe("run ledger reconciliation", () => {
  it("builds the same identity regardless of object key or operation order", () => {
    const first = claim("SOURCE_VERIFIED", "issue#170", "success");
    const second = claim("MERGED_TO_MAIN", "issue#170", "merged");
    const left = normalizeEvidence(evidence([
      { action: "ADD", claim: first },
      { action: "ADD", claim: second },
    ]));
    const right = normalizeEvidence({
      operations: [
        { claim: { ...second }, action: "ADD" },
        { claim: { ...first }, action: "ADD" },
      ],
      observedMainSha: MAIN,
      runId: "2026-09-04-reconcile-test",
      schemaVersion: 1,
    });
    expect(left.identity).toBe(right.identity);
    expect(left.evidenceDigest).toBe(right.evidenceDigest);
  });

  it("adds claims and becomes byte-stable when the same identity is applied again", () => {
    const input = evidence(
      [{ action: "ADD", claim: claim() }],
      { status: "VERIFIED", checkedAt: "2026-09-04T06:00:00Z" },
    );
    const first = apply(ledger(), input);
    expect(first.changed).toBe(true);
    expect(first.ledger.completionTruth.claims).toEqual([claim()]);
    expect(first.ledger.completionTruth.status).toBe("VERIFIED");
    expect(first.ledger.reconciliation.identities).toHaveLength(1);

    const second = apply(first.ledger, input);
    expect(second.changed).toBe(false);
    expect(stableStringify(second.ledger)).toBe(stableStringify(first.ledger));
  });

  it("does not create another candidate when the same evidence digest is replayed after main advances", () => {
    const input = evidence([{ action: "ADD", claim: claim() }]);
    const first = apply(ledger(), input);
    const advancedMain = "c".repeat(40);
    const replay = reconcileLedger({
      ledger: first.ledger,
      evidence: { ...input, observedMainSha: advancedMain },
      currentMainSha: advancedMain,
      currentLedgerSha: LEDGER_SHA,
      expectedLedgerSha: LEDGER_SHA,
    });
    expect(replay.changed).toBe(false);
    expect(replay.evidence.identity).not.toBe(first.evidence.identity);
    expect(replay.evidence.evidenceDigest).toBe(first.evidence.evidenceDigest);
    expect(replay.ledger.reconciliation.identities).toHaveLength(1);
  });

  it("replaces an exact contradicted claim without deleting unrelated evidence", () => {
    const bad = {
      type: "CI_GREEN",
      subject: "pull/177 canonical TEST first attempt",
      claimedState: "success",
      observedState: "failed",
      verification: "CONTRADICTED",
      evidenceRef: "github:actions/runs/1",
    };
    const keep = claim("MERGED_TO_MAIN", "issue#170", "merged");
    const current = ledger();
    current.completionTruth.claims = [bad, keep];
    const correction = claim("OTHER", "pull/177 canonical TEST first attempt", "failed_attempt_recorded");
    const result = apply(current, evidence([
      { action: "REPLACE", expectedClaim: bad, claim: correction },
    ]));
    expect(result.ledger.completionTruth.claims).toEqual([correction, keep]);
  });

  it("fails closed on stale main or ledger identity", () => {
    expect(() => reconcileLedger({
      ledger: ledger(), evidence: evidence([{ action: "ADD", claim: claim() }]),
      currentMainSha: "c".repeat(40), currentLedgerSha: LEDGER_SHA, expectedLedgerSha: LEDGER_SHA,
    })).toThrow(/STALE_MAIN_SHA/);
    expect(() => apply(ledger(), evidence([{ action: "ADD", claim: claim() }]), "d".repeat(40)))
      .toThrow(/STALE_LEDGER_SHA/);
  });

  it("keeps historical v2.2 ledgers read-only", () => {
    expect(() => apply(ledger(2), evidence([{ action: "ADD", claim: claim() }])))
      .toThrow(/HISTORICAL_LEDGER_READ_ONLY/);
  });

  it("requires the exact old claim for a replacement", () => {
    const current = ledger();
    current.completionTruth.claims = [claim()];
    expect(() => apply(current, evidence([{
      action: "REPLACE",
      expectedClaim: claim("SOURCE_VERIFIED", "issue#171", "success"),
      claim: claim("SOURCE_VERIFIED", "issue#171", "failed"),
    }])))
      .toThrow(/EXPECTED_CLAIM_MISMATCH/);
  });

  it("rejects new legacy CI_GREEN claims and noncanonical Product subjects", () => {
    expect(() => normalizeEvidence(evidence([{
      action: "ADD",
      claim: claim("CI_GREEN", "pull/170", "success"),
    }]))).toThrow(/UNSAFE_CLAIM_TYPE/);
    expect(() => normalizeEvidence(evidence([{
      action: "ADD",
      claim: claim("SOURCE_VERIFIED", "issue#170 slice A", "success"),
    }]))).toThrow(/NON_CANONICAL_SUBJECT/);
  });

  it("computes Git blob SHA from the exact bytes", () => {
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
