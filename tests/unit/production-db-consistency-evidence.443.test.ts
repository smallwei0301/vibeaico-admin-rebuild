import { describe, expect, it } from 'vitest';
import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';
const MAIN='a'.repeat(40), PLAN='b'.repeat(64), FP='c'.repeat(64);
function report(diff:any[]=[]){return {observedMainSha:MAIN,status:diff.length?'EXPECTED_PENDING_PRODUCTION':'MATCH',differenceCount:diff.length,differences:diff,environments:{TEST:{observedAt:'2026-09-14T09:50:00Z'},PRODUCTION:{observedAt:'2026-09-14T09:49:00Z'}},environmentStatuses:{TEST:'MATCH',PRODUCTION:diff.length?'EXPECTED_PENDING_PRODUCTION':'MATCH'},exceptionSummary:{expired:0,unmatched:0},safety:{authorizesDatabaseWrite:false}};}
const pending={environment:'PRODUCTION',surface:'columns',objectKey:'public.example.new_col',expectedFingerprint:FP,observedFingerprint:null,classification:'EXPECTED_PENDING_PRODUCTION'};
describe('Production scoped consistency evidence',()=>{
  it('accepts MATCH and only the explicitly planned pending Production diff',()=>{
    expect(buildProductionConsistencyEvidence({report:report(),mainSha:MAIN,planDigest:PLAN}).unexplainedDifferences).toBe(0);
    const r=buildProductionConsistencyEvidence({report:report([pending]),plannedProductionDifferences:[pending],mainSha:MAIN,planDigest:PLAN});
    expect(r).toMatchObject({status:'CONSISTENCY_VERIFIED',plannedProductionDifferenceCount:1,databaseMutationAuthorized:false});
  });
  it('blocks unplanned or changed Production drift and pending TEST schema',()=>{
    expect(()=>buildProductionConsistencyEvidence({report:report([pending]),mainSha:MAIN,planDigest:PLAN})).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
    expect(()=>buildProductionConsistencyEvidence({report:report([{...pending,observedFingerprint:'d'.repeat(64)}]),plannedProductionDifferences:[pending],mainSha:MAIN,planDigest:PLAN})).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
    const r=report(); r.environmentStatuses.TEST='EXPECTED_PENDING_TEST';
    expect(()=>buildProductionConsistencyEvidence({report:r,mainSha:MAIN,planDigest:PLAN})).toThrow(/TEST_SCHEMA_NOT_READY/);
  });
  it('allows durable intentional differences but rejects stale exception state',()=>{
    const d={...pending,classification:'INTENTIONAL_DIFFERENCE',exception:{issue:'#1',expiresAt:'2026-10-01T00:00:00Z'}};
    const r=report([d]); r.status='INTENTIONAL_DIFFERENCE'; r.environmentStatuses.PRODUCTION='INTENTIONAL_DIFFERENCE';
    expect(buildProductionConsistencyEvidence({report:r,mainSha:MAIN,planDigest:PLAN}).intentionalDifferenceCount).toBe(1);
    r.exceptionSummary.expired=1;
    expect(()=>buildProductionConsistencyEvidence({report:r,mainSha:MAIN,planDigest:PLAN})).toThrow(/STALE_DRIFT_EXCEPTION/);
  });
});
