import { describe, expect, it } from 'vitest';
import { auditProductionDbWriterBypasses, collectProductionDbExecutableSources } from '../../scripts/agents/production-db-writer-bypass-audit.mjs';

describe('Production DB writer bypass audit #447',()=>{
  it('keeps the real repo write surface bounded to controlled writer + two TEST-only runners',()=>{
    const result=auditProductionDbWriterBypasses(collectProductionDbExecutableSources(process.cwd()));
    expect(result).toMatchObject({
      status:'PRODUCTION_DB_WRITE_BYPASS_AUDIT_CLEAN',
      broadTokenConsumers:[],
      databaseMutationAuthorized:false,
    });
    expect(result.writeEndpointFiles).toEqual([
      'scripts/db/controlled-production-db-release.mjs',
      'scripts/db/run-migrations.mjs',
      'scripts/db/validate-production-db-release-on-test.mjs',
    ]);
  });

  it('rejects a new executable Management API write endpoint',()=>{
    const sources=collectProductionDbExecutableSources(process.cwd());
    sources['scripts/db/new-side-door.mjs']="fetch('https://api.supabase.com/v1/projects/x/database/query')";
    expect(()=>auditProductionDbWriterBypasses(sources)).toThrow(/UNAPPROVED_PRODUCTION_DB_WRITE_PATH/);
  });

  it('rejects workflow consumption of broad SUPABASE_ACCESS_TOKEN',()=>{
    const sources=collectProductionDbExecutableSources(process.cwd());
    sources['.github/workflows/bad.yml']='env:\n  TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n';
    expect(()=>auditProductionDbWriterBypasses(sources)).toThrow(/BROAD_SUPABASE_TOKEN_CONSUMER/);
  });

  it('rejects loss of the legacy Production fail-closed guard',()=>{
    const sources=collectProductionDbExecutableSources(process.cwd());
    sources['scripts/db/run-migrations.mjs']=String(sources['scripts/db/run-migrations.mjs']).replace('PRODUCTION_CONTROLLED_WRITER_REQUIRED','REMOVED_GUARD');
    expect(()=>auditProductionDbWriterBypasses(sources)).toThrow(/LEGACY_RUNNER_PRODUCTION_GUARD_MISSING/);
  });

  it('rejects weakening the modern G3 validator Production guard or scoped-token boundary',()=>{
    for (const mutate of [
      (source:string)=>source.replace('PRODUCTION_TARGET_FORBIDDEN','REMOVED_GUARD'),
      (source:string)=>source.replace('TEST_DB_RELEASE_TOKEN','SUPABASE_ACCESS_TOKEN'),
      (source:string)=>source.replace("const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';","const TEST_PROJECT_REF = 'other';"),
    ]) {
      const sources=collectProductionDbExecutableSources(process.cwd());
      sources['scripts/db/validate-production-db-release-on-test.mjs']=mutate(String(sources['scripts/db/validate-production-db-release-on-test.mjs']));
      expect(()=>auditProductionDbWriterBypasses(sources)).toThrow(/G3_/);
    }
  });

  it('allows the post-TEST observer to mention broad token exactly once only as a fail-closed rejection guard',()=>{
    const path='scripts/agents/production-db-g3-post-test-schema.mjs';
    const original=String(collectProductionDbExecutableSources(process.cwd())[path]);
    expect(original.match(/process\.env\.SUPABASE_ACCESS_TOKEN/g)).toHaveLength(1);
    expect(original).toContain("if (process.env.SUPABASE_ACCESS_TOKEN) fail('BROAD_SCHEMA_TOKEN_FORBIDDEN'");
    expect(()=>auditProductionDbWriterBypasses(collectProductionDbExecutableSources(process.cwd()))).not.toThrow();
  });

  it('rejects any weakening of the post-TEST observer broad-token/read-only boundary',()=>{
    const path='scripts/agents/production-db-g3-post-test-schema.mjs';
    const mutations=[
      (source:string)=>source.replace('BROAD_SCHEMA_TOKEN_FORBIDDEN','REMOVED_GUARD'),
      (source:string)=>`${source}\nconst accidentalBroadToken = process.env.SUPABASE_ACCESS_TOKEN;\n`,
      (source:string)=>source.replaceAll('SCHEMA_OBSERVER_TOKEN','REMOVED_OBSERVER_TOKEN'),
      (source:string)=>source.replace("environment: 'TEST'","environment: 'PRODUCTION'"),
      (source:string)=>source.replace('CAPTURE_ONLY_G2_COMPARISON_REQUIRED','G2_CONSISTENCY_VERIFIED'),
    ];
    for (const mutate of mutations) {
      const sources=collectProductionDbExecutableSources(process.cwd());
      sources[path]=mutate(String(sources[path]));
      expect(()=>auditProductionDbWriterBypasses(sources)).toThrow(/G3_POST_TEST_/);
    }
  });
});
