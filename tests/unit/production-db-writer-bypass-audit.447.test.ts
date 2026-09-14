import { describe, expect, it } from 'vitest';
import { auditProductionDbWriterBypasses, collectProductionDbExecutableSources } from '../../scripts/agents/production-db-writer-bypass-audit.mjs';

describe('Production DB writer bypass audit #447',()=>{
  it('keeps the real repo write surface bounded to controlled writer + TEST-only legacy runner',()=>{
    const result=auditProductionDbWriterBypasses(collectProductionDbExecutableSources(process.cwd()));
    expect(result).toMatchObject({
      status:'PRODUCTION_DB_WRITE_BYPASS_AUDIT_CLEAN',
      broadTokenConsumers:[],
      databaseMutationAuthorized:false,
    });
    expect(result.writeEndpointFiles).toEqual([
      'scripts/db/controlled-production-db-release.mjs',
      'scripts/db/run-migrations.mjs',
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
});
