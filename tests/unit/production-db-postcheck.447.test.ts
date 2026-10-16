import { describe, expect, it } from 'vitest';
import { advanceReleaseJournal, createReleaseJournal } from '../../scripts/agents/production-db-release-journal.mjs';
import { finalizeProductionDbPostcheck } from '../../scripts/agents/production-db-postcheck.mjs';

const MAIN='a'.repeat(40), PLAN='b'.repeat(64), NEW_MAIN='c'.repeat(40);
const plan={releaseId:'release-447-postcheck',mainSha:MAIN,planDigest:PLAN,
  migrations:[{repoFile:'0136_issue_755_create_tour_order_invoker',ledgerVersion:'20261016093644'}]};
const consistency=()=>({status:'CONSISTENCY_VERIFIED',mainSha:MAIN,planDigest:PLAN,
  plannedProductionDifferences:[
    {surface:'routines',objectKey:'public.create_tour_order(uuid)',expectedFingerprint:'1'.repeat(64)},
    {surface:'migrationLedger',objectKey:'0136/0136_issue_755_create_tour_order_invoker',expectedFingerprint:'2'.repeat(64)},
  ]});
function applied(){
  let j=createReleaseJournal({releaseId:plan.releaseId,mainSha:MAIN,planDigest:PLAN,createdAt:'2026-09-14T13:00:00Z'});
  j=advanceReleaseJournal(j,{status:'APPLYING',at:'2026-09-14T13:01:00Z',evidenceRef:'writer:start'});
  return advanceReleaseJournal(j,{status:'APPLIED_CONFIRMED',at:'2026-09-14T13:02:00Z',evidenceRef:'readback:applied'});
}
function report(differences:any[]=[],status='MATCH',extra:any={}){return {observedMainSha:MAIN,status,differences,environmentStatuses:{TEST:'MATCH',PRODUCTION:status},exceptionSummary:{expired:0,unmatched:0},safety:{authorizesDatabaseWrite:false},...extra};}
const diff=(surface:string,objectKey:string,expectedFingerprint:string|null='9'.repeat(64),observedFingerprint:string|null=null,classification:string|null=null)=>
  ({environment:'PRODUCTION',surface,objectKey,expectedFingerprint,observedFingerprint,classification,exception:null});
const run=(over:any={})=>finalizeProductionDbPostcheck({report:report(),preApplyReport:report(),plan,journal:applied(),consistency:consistency(),now:'2026-09-14T13:03:00Z',...over});
function failure(over:any){
  try { run(over); } catch (error:any) {
    expect(error.code).toBe('POSTCHECK_FAILED');
    expect(error.journal.status).toBe('POSTCHECK_FAILED');
    return error.message as string;
  }
  throw new Error('expected postcheck failure');
}

describe('Production DB G7 scoped postcheck #447',()=>{
  it('marks schema ready when the release objects match',()=>{
    expect(run()).toMatchObject({status:'PRODUCTION_SCHEMA_READY',journal:{status:'PRODUCTION_SCHEMA_READY'},databaseMutationAuthorized:false});
  });

  it('ignores unrelated Production drift outside the release scope even when overall status is DRIFT_BLOCKED',()=>{
    const unrelated=[diff('columns','public.other.col'),diff('migrationLedger','0138/0138_other_pending',undefined,null,'EXPECTED_PENDING_PRODUCTION'),diff('acl','table:public.other')];
    expect(run({report:report(unrelated,'DRIFT_BLOCKED'),preApplyReport:report(unrelated,'DRIFT_BLOCKED')})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'});
  });

  it('accepts the applied ledger identity (14-digit version present, canonical key missing)',()=>{
    const ledger=[diff('migrationLedger','0136/0136_issue_755_create_tour_order_invoker','2'.repeat(64),null),
      diff('migrationLedger','20261016093644/0136_issue_755_create_tour_order_invoker',null,'3'.repeat(64))];
    expect(run({report:report(ledger,'DRIFT_BLOCKED')})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'});
  });

  it('fails closed when both the canonical and the applied ledger identity exist in Production',()=>{
    const applied=[diff('migrationLedger','20261016093644/0136_issue_755_create_tour_order_invoker',null,'3'.repeat(64))]; // canonical row present => not reported missing
    expect(failure({report:report(applied,'DRIFT_BLOCKED')})).toMatch(/POSTCHECK_DUPLICATE_LEDGER_IDENTITY|both its canonical and applied/);
  });

  it('fails when a planned object still differs from canonical',()=>{
    const message=failure({report:report([diff('routines','public.create_tour_order(uuid)','1'.repeat(64),'8'.repeat(64))],'DRIFT_BLOCKED')});
    expect(message).toMatch(/still differs/);
  });

  it('fails when the ledger version of a planned migration is still pending',()=>{
    const message=failure({report:report([diff('migrationLedger','0136/0136_issue_755_create_tour_order_invoker','2'.repeat(64),null,'EXPECTED_PENDING_PRODUCTION')])});
    expect(message).toMatch(/still pending/);
  });

  it.each([
    ['missing consistency evidence',{consistency:undefined}],
    ['empty plannedProductionDifferences',{consistency:{...consistency(),plannedProductionDifferences:[]}}],
    ['non-array plannedProductionDifferences',{consistency:{...consistency(),plannedProductionDifferences:undefined}}],
    ['consistency for another plan',{consistency:{...consistency(),planDigest:'d'.repeat(64)}}],
    ['evidence unavailable',{report:report([],'EVIDENCE_UNAVAILABLE')}],
    ['report without differences array',{report:{...report(),differences:undefined}}],
    ['non read-only observer',{report:report([],'MATCH',{safety:{authorizesDatabaseWrite:true}})}],
    ['stale exceptions',{report:report([],'MATCH',{exceptionSummary:{expired:1,unmatched:0}})}],
    ['unmatched exceptions',{report:report([],'MATCH',{exceptionSummary:{expired:0,unmatched:1}})}],
    ['plan without migrations',{plan:{...plan,migrations:[]}}],
  ])('fails closed on %s',(_label,over)=>{ failure(over); });

  it('rejects a report for another main unless migrations are proven unchanged since the plan',()=>{
    const moved=report([],'MATCH',{observedMainSha:NEW_MAIN});
    expect(failure({report:moved})).toMatch(/POSTCHECK_MAIN_MISMATCH|release main SHA/);
    expect(failure({report:moved,migrationsUnchangedSincePlan:false})).toMatch(/release main SHA/);
    expect(run({report:moved,migrationsUnchangedSincePlan:true})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'});
  });

  describe('pre-apply G2 baseline for unrelated Production drift',()=>{
    const pre=[diff('columns','public.other.col','9'.repeat(64),'4'.repeat(64)),diff('acl','table:public.other','9'.repeat(64),'5'.repeat(64))];
    const post=(fp='4'.repeat(64),aclFp='6'.repeat(64))=>[diff('columns','public.other.col','9'.repeat(64),fp),diff('acl','table:public.other','9'.repeat(64),aclFp)];
    it('is READY when unrelated drift is identical to the same-version G2 baseline (acl included)',()=>{
      expect(run({report:report(post('4'.repeat(64),'5'.repeat(64)),'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED',{aclFingerprintVersion:2})})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'});
      expect(run({report:report(post('4'.repeat(64),'5'.repeat(64)),'DRIFT_BLOCKED'),preApplyReport:report(pre,'DRIFT_BLOCKED')})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'}); // both missing = v1
    });
    it('fails when an out-of-scope acl fingerprint changed within the same version',()=>{
      expect(failure({report:report(post('4'.repeat(64),'6'.repeat(64)),'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED',{aclFingerprintVersion:2})})).toMatch(/changed since the pre-apply report/);
    });
    it('fails closed on an out-of-scope acl difference when the ACL versions differ (missing G2 field = v1)',()=>{
      expect(failure({report:report(post('4'.repeat(64),'5'.repeat(64)),'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED')})).toMatch(/cannot be compared across ACL fingerprint versions/);
    });
    it('is READY across differing ACL versions when G7 has no out-of-scope acl difference',()=>{
      const noAcl=[diff('columns','public.other.col','9'.repeat(64),'4'.repeat(64))];
      expect(run({report:report(noAcl,'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED')})).toMatchObject({status:'PRODUCTION_SCHEMA_READY'});
    });
    it('fails on a new non-planned Production difference absent from G2',()=>{
      const added=[...post('4'.repeat(64),'5'.repeat(64)),diff('acl','table:public.new_after_apply','9'.repeat(64),'7'.repeat(64))];
      expect(failure({report:report(added,'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED',{aclFingerprintVersion:2})})).toMatch(/was not present before apply/);
    });
    it('fails when a pre-existing non-acl drift changed its observed fingerprint',()=>{
      expect(failure({report:report(post('8'.repeat(64)),'DRIFT_BLOCKED',{aclFingerprintVersion:2}),preApplyReport:report(pre,'DRIFT_BLOCKED',{aclFingerprintVersion:2})})).toMatch(/changed since the pre-apply report/);
    });
    it.each([
      ['missing',{preApplyReport:undefined}],
      ['unavailable',{preApplyReport:report([],'EVIDENCE_UNAVAILABLE')}],
      ['no differences array',{preApplyReport:{...report(),differences:undefined}}],
      ['another main',{preApplyReport:report([],'MATCH',{observedMainSha:NEW_MAIN})}],
      ['not bound by the consistency evidence',{consistency:{...consistency(),rawObserverStatus:'DRIFT_BLOCKED',rawObserverDifferenceCount:3}}],
    ])('fails closed on a %s G2 report',(_label,over)=>{ expect(failure(over)).toMatch(/pre-apply|G2/); });
  });

  it('keeps a terminal POSTCHECK_FAILED journal that cannot be blindly retried',()=>{
    try {
      run({report:report([diff('routines','public.create_tour_order(uuid)')],'DRIFT_BLOCKED')});
      throw new Error('expected postcheck failure');
    } catch (error:any) {
      expect(error.journal.status).toBe('POSTCHECK_FAILED');
      expect(()=>advanceReleaseJournal(error.journal,{status:'APPLYING',at:'2026-09-14T13:04:00Z',evidenceRef:'writer:blind-retry'})).toThrow(/INVALID_JOURNAL_TRANSITION/);
    }
  });
});
