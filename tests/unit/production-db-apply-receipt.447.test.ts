import { describe, expect, it } from 'vitest';
import {
  advanceApplyReceipt,
  assertApplyReceiptAdmitted,
  assertConsumingApplyReceipt,
  createProductionDbApplyReceipt,
} from '../../scripts/agents/production-db-apply-receipt.mjs';

const MAIN='a'.repeat(40), PLAN='b'.repeat(64), PROJECT='egehnijjpgijmccagxac';
const plan={releaseId:'release-447-receipt',mainSha:MAIN,planDigest:PLAN};
function receipt(){return createProductionDbApplyReceipt({releaseId:plan.releaseId,mainSha:MAIN,planDigest:PLAN,projectRef:PROJECT,githubRunId:'12345',githubRunAttempt:1,issuedAt:'2026-09-14T13:00:00Z'});}

describe('Production DB single-use apply receipt #447',()=>{
  it('admits one fresh exact-plan ISSUED receipt only for preparation',()=>{
    expect(assertApplyReceiptAdmitted(receipt(),plan,PROJECT,{now:'2026-09-14T13:04:00Z'})).toMatchObject({status:'APPLY_RECEIPT_ADMITTED',databaseMutationAuthorized:false});
    expect(()=>assertConsumingApplyReceipt(receipt(),plan,PROJECT,{now:'2026-09-14T13:04:00Z'})).toThrow(/APPLY_RECEIPT_NOT_DURABLY_CONSUMING/);
  });

  it('requires CONSUMING receipt at writer execution and blocks replay after terminal state',()=>{
    const consuming=advanceApplyReceipt(receipt(),'CONSUMING','2026-09-14T13:01:00Z');
    expect(assertConsumingApplyReceipt(consuming,plan,PROJECT,{now:'2026-09-14T13:03:00Z'})).toMatchObject({status:'CONSUMING_APPLY_RECEIPT_VERIFIED'});
    const consumed=advanceApplyReceipt(consuming,'CONSUMED','2026-09-14T13:02:00Z');
    expect(()=>assertApplyReceiptAdmitted(consumed,plan,PROJECT,{now:'2026-09-14T13:03:00Z'})).toThrow(/APPLY_RECEIPT_REPLAY/);
    expect(()=>assertConsumingApplyReceipt(consumed,plan,PROJECT,{now:'2026-09-14T13:03:00Z'})).toThrow(/APPLY_RECEIPT_NOT_DURABLY_CONSUMING/);
    const unknown=advanceApplyReceipt(consuming,'UNKNOWN','2026-09-14T13:02:00Z');
    expect(()=>assertApplyReceiptAdmitted(unknown,plan,PROJECT,{now:'2026-09-14T13:03:00Z'})).toThrow(/APPLY_RECEIPT_REPLAY/);
    expect(()=>assertConsumingApplyReceipt(unknown,plan,PROJECT,{now:'2026-09-14T13:03:00Z'})).toThrow(/APPLY_RECEIPT_NOT_DURABLY_CONSUMING/);
  });

  it('blocks wrong project, stale receipt and plan mismatch in both phases',()=>{
    expect(()=>assertApplyReceiptAdmitted(receipt(),plan,'nmwhwngojosmagjuvxol',{now:'2026-09-14T13:01:00Z'})).toThrow(/APPLY_RECEIPT_PROJECT_MISMATCH/);
    expect(()=>assertApplyReceiptAdmitted(receipt(),plan,PROJECT,{now:'2026-09-14T13:06:00Z'})).toThrow(/APPLY_RECEIPT_STALE/);
    expect(()=>assertApplyReceiptAdmitted(receipt(),{...plan,planDigest:'c'.repeat(64)},PROJECT,{now:'2026-09-14T13:01:00Z'})).toThrow(/APPLY_RECEIPT_PLAN_MISMATCH/);
    const consuming=advanceApplyReceipt(receipt(),'CONSUMING','2026-09-14T13:01:00Z');
    expect(()=>assertConsumingApplyReceipt(consuming,plan,PROJECT,{now:'2026-09-14T13:06:00Z'})).toThrow(/APPLY_RECEIPT_STALE/);
  });

  it('detects receipt mutation instead of accepting edited admission data',()=>{
    const forged={...receipt(),githubRunId:'other-run'};
    expect(()=>assertApplyReceiptAdmitted(forged,plan,PROJECT,{now:'2026-09-14T13:01:00Z'})).toThrow(/APPLY_RECEIPT_DIGEST_MISMATCH/);
  });
});
