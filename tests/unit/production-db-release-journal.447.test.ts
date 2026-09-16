import { describe, expect, it } from 'vitest';
import { advanceReleaseJournal, assertWriterAttemptAllowed, createReleaseJournal } from '../../scripts/agents/production-db-release-journal.mjs';

const MAIN='a'.repeat(40), PLAN='b'.repeat(64);
const at=(minute:number)=>`2026-09-14T13:${String(minute).padStart(2,'0')}:00Z`;
function base(){return createReleaseJournal({releaseId:'release-447-journal',mainSha:MAIN,planDigest:PLAN,createdAt:at(0)});}

describe('Production DB release journal #447',()=>{
  it('allows first writer attempt and a retry only after readback proves not applied',()=>{
    let journal=base();
    expect(assertWriterAttemptAllowed(journal).status).toBe('WRITER_ATTEMPT_ALLOWED');
    journal=advanceReleaseJournal(journal,{status:'APPLYING',at:at(1),evidenceRef:'writer:attempt-1'});
    journal=advanceReleaseJournal(journal,{status:'APPLY_UNKNOWN',at:at(2),evidenceRef:'writer:network-uncertain'});
    expect(()=>assertWriterAttemptAllowed(journal)).toThrow(/WRITER_RETRY_BLOCKED/);
    journal=advanceReleaseJournal(journal,{status:'NOT_APPLIED_CONFIRMED',at:at(3),evidenceRef:'readback:ledger-unchanged'});
    expect(assertWriterAttemptAllowed(journal).status).toBe('WRITER_ATTEMPT_ALLOWED');
  });

  it('never allows APPLY_UNKNOWN to jump directly back to APPLYING',()=>{
    let journal=advanceReleaseJournal(base(),{status:'APPLYING',at:at(1),evidenceRef:'writer:start'});
    journal=advanceReleaseJournal(journal,{status:'APPLY_UNKNOWN',at:at(2),evidenceRef:'writer:unknown'});
    expect(()=>advanceReleaseJournal(journal,{status:'APPLYING',at:at(3),evidenceRef:'writer:blind-retry'})).toThrow(/INVALID_JOURNAL_TRANSITION/);
  });

  it('makes POSTCHECK_FAILED and PRODUCTION_SCHEMA_READY terminal',()=>{
    let ready=advanceReleaseJournal(base(),{status:'APPLYING',at:at(1),evidenceRef:'writer:start'});
    ready=advanceReleaseJournal(ready,{status:'APPLIED_CONFIRMED',at:at(2),evidenceRef:'readback:ledger-applied'});
    const failed=advanceReleaseJournal(ready,{status:'POSTCHECK_FAILED',at:at(3),evidenceRef:'postcheck:drift'});
    expect(()=>advanceReleaseJournal(failed,{status:'APPLYING',at:at(4),evidenceRef:'writer:retry'})).toThrow(/INVALID_JOURNAL_TRANSITION/);
    const terminal=advanceReleaseJournal(ready,{status:'PRODUCTION_SCHEMA_READY',at:at(3),evidenceRef:'postcheck:verified'});
    expect(()=>advanceReleaseJournal(terminal,{status:'APPLYING',at:at(4),evidenceRef:'writer:extra'})).toThrow(/INVALID_JOURNAL_TRANSITION/);
  });
});
