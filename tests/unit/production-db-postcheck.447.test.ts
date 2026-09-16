import { describe, expect, it } from 'vitest';
import { advanceReleaseJournal, createReleaseJournal } from '../../scripts/agents/production-db-release-journal.mjs';
import { finalizeProductionDbPostcheck } from '../../scripts/agents/production-db-postcheck.mjs';

const MAIN='a'.repeat(40), PLAN='b'.repeat(64);
const plan={releaseId:'release-447-postcheck',mainSha:MAIN,planDigest:PLAN};
function applied(){
  let j=createReleaseJournal({releaseId:plan.releaseId,mainSha:MAIN,planDigest:PLAN,createdAt:'2026-09-14T13:00:00Z'});
  j=advanceReleaseJournal(j,{status:'APPLYING',at:'2026-09-14T13:01:00Z',evidenceRef:'writer:start'});
  return advanceReleaseJournal(j,{status:'APPLIED_CONFIRMED',at:'2026-09-14T13:02:00Z',evidenceRef:'readback:applied'});
}
function report(status='MATCH',differences:any[]=[]){return {observedMainSha:MAIN,status,differences,environmentStatuses:{TEST:'MATCH',PRODUCTION:status},exceptionSummary:{expired:0,unmatched:0},safety:{authorizesDatabaseWrite:false}};}

describe('Production DB G7 postcheck #447',()=>{
  it('marks schema ready only after Production MATCH',()=>{
    expect(finalizeProductionDbPostcheck({report:report(),plan,journal:applied(),now:'2026-09-14T13:03:00Z'}))
      .toMatchObject({status:'PRODUCTION_SCHEMA_READY',journal:{status:'PRODUCTION_SCHEMA_READY'},databaseMutationAuthorized:false});
  });

  it('turns remaining pending Production drift into terminal POSTCHECK_FAILED',()=>{
    const pending={environment:'PRODUCTION',surface:'columns',objectKey:'public.x.y',classification:'EXPECTED_PENDING_PRODUCTION'};
    try {
      finalizeProductionDbPostcheck({report:report('EXPECTED_PENDING_PRODUCTION',[pending]),plan,journal:applied(),now:'2026-09-14T13:03:00Z'});
      throw new Error('expected postcheck failure');
    } catch (error:any) {
      expect(error.code).toBe('POSTCHECK_FAILED');
      expect(error.journal.status).toBe('POSTCHECK_FAILED');
      expect(()=>advanceReleaseJournal(error.journal,{status:'APPLYING',at:'2026-09-14T13:04:00Z',evidenceRef:'writer:blind-retry'})).toThrow(/INVALID_JOURNAL_TRANSITION/);
    }
  });
});
