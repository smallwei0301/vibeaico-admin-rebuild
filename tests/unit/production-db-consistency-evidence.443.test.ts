import { describe, expect, it } from 'vitest';
import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';

const MAIN='a'.repeat(40), PLAN='b'.repeat(64), FP='c'.repeat(64);
const plan={mainSha:MAIN,planDigest:PLAN,migrations:[{repoFile:'0105_test'}]};
const manifest={schemaVersion:1,entries:[{repoFile:'0105_test',impacts:[{surface:'columns',objectKey:'public.example.new_col'}]}]};
function report(diff:any[]=[]){return {observedMainSha:MAIN,status:diff.length?'EXPECTED_PENDING_PRODUCTION':'MATCH',differenceCount:diff.length,differences:diff,environments:{TEST:{observedAt:'2026-09-14T09:50:00Z'},PRODUCTION:{observedAt:'2026-09-14T09:49:00Z'}},environmentStatuses:{TEST:'MATCH',PRODUCTION:diff.length?'EXPECTED_PENDING_PRODUCTION':'MATCH'},exceptionSummary:{expired:0,unmatched:0},safety:{authorizesDatabaseWrite:false}};}
const pending={environment:'PRODUCTION',surface:'columns',objectKey:'public.example.new_col',expectedFingerprint:FP,observedFingerprint:null,classification:'EXPECTED_PENDING_PRODUCTION'};
const args=(r:any,m:any=manifest)=>({report:r,plan,impactManifest:m,mainSha:MAIN,planDigest:PLAN});

describe('Production scoped consistency evidence',()=>{
  it('accepts MATCH and derives only live pending diffs that are allowlisted by planned migrations',()=>{
    expect(buildProductionConsistencyEvidence(args(report())).unexplainedDifferences).toBe(0);
    expect(buildProductionConsistencyEvidence(args(report([pending])))).toMatchObject({status:'CONSISTENCY_VERIFIED',plannedProductionDifferenceCount:1,databaseMutationAuthorized:false});
  });

  it('blocks pending Production drift outside the trusted migration impact manifest',()=>{
    const unplanned={...pending,objectKey:'public.other.surprise'};
    expect(()=>buildProductionConsistencyEvidence(args(report([unplanned])))).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
  });

  it('blocks missing/wildcard manifest coverage and pending TEST schema',()=>{
    const missing={schemaVersion:1,entries:[]};
    expect(()=>buildProductionConsistencyEvidence(args(report([pending]),missing))).toThrow(/MISSING_IMPACT_MANIFEST_ENTRY/);
    const wildcard={schemaVersion:1,entries:[{repoFile:'0105_test',impacts:[{surface:'columns',objectKey:'public.example.*'}]}]};
    expect(()=>buildProductionConsistencyEvidence(args(report([pending]),wildcard))).toThrow(/INVALID_IMPACT_OBJECT/);
    const r=report(); r.environmentStatuses.TEST='EXPECTED_PENDING_TEST';
    expect(()=>buildProductionConsistencyEvidence(args(r))).toThrow(/TEST_SCHEMA_NOT_READY/);
  });

  it('allows durable intentional differences but rejects stale exception state',()=>{
    const d={...pending,classification:'INTENTIONAL_DIFFERENCE',exception:{issue:'#1',expiresAt:'2026-10-01T00:00:00Z'}};
    const r=report([d]); r.status='INTENTIONAL_DIFFERENCE'; r.environmentStatuses.PRODUCTION='INTENTIONAL_DIFFERENCE';
    expect(buildProductionConsistencyEvidence(args(r)).intentionalDifferenceCount).toBe(1);
    r.exceptionSummary.expired=1;
    expect(()=>buildProductionConsistencyEvidence(args(r))).toThrow(/STALE_DRIFT_EXCEPTION/);
  });
});
