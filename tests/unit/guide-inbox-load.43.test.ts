import { describe, expect, it } from 'vitest';
import { createGuideInboxLoader, guideInboxForTenant, type GuideInboxLoadState } from '@/lib/guide-inbox-load';
const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
describe('GUIDE inbox consumer request lifecycle', () => {
  it('failure is not empty; retries can recover to real empty and data', async () => {
    let state: GuideInboxLoadState<string> = {tenantId:'a',status:'loading'};
    const loader = createGuideInboxLoader<string>(s=>{state=s;});
    await loader.load('a',()=>Promise.reject(new Error('offline')));
    expect(state).toEqual({tenantId:'a',status:'error'});
    await loader.load('a',()=>Promise.resolve([]));
    expect(state).toEqual({tenantId:'a',status:'success',items:[]});
    await loader.load('a',()=>Promise.resolve(['first','second']));
    expect(state).toEqual({tenantId:'a',status:'success',items:['first','second']});
  });
  it('older success cannot overwrite newer pending/error/data', async () => {
    const seen: GuideInboxLoadState<string>[]=[];const loader=createGuideInboxLoader<string>(s=>seen.push(s));
    const old=deferred<string[]>(), fresh=deferred<string[]>();
    const first=loader.load('a',()=>old.promise), second=loader.load('a',()=>fresh.promise);
    old.resolve(['stale']);await first;
    expect(seen.at(-1)).toEqual({tenantId:'a',status:'loading'});
    fresh.reject(Error('timeout'));await second;
    expect(seen.at(-1)).toEqual({tenantId:'a',status:'error'});
    await loader.load('a',()=>Promise.resolve(['fresh']));
    expect(seen.at(-1)).toEqual({tenantId:'a',status:'success',items:['fresh']});
  });
  it('same business-type tenant switches hide old cards immediately and suppress late failures', async () => {
    let state: GuideInboxLoadState<string>={tenantId:'a',status:'success',items:['private-a']};
    expect(guideInboxForTenant(state,'b')).toEqual({tenantId:'b',status:'loading'});
    const loader=createGuideInboxLoader<string>(s=>{state=s;});const old=deferred<string[]>();
    const first=loader.load('a',()=>old.promise);
    await loader.load('b',()=>Promise.resolve(['private-b']));old.reject(Error('late'));await first;
    expect(guideInboxForTenant(state,'b')).toEqual({tenantId:'b',status:'success',items:['private-b']});
    expect(guideInboxForTenant(state,'a')).toEqual({tenantId:'a',status:'loading'});
  });
  it('unmount invalidation drops late result; remount can load', async () => {
    const seen: GuideInboxLoadState<string>[]=[];const loader=createGuideInboxLoader<string>(s=>seen.push(s));const old=deferred<string[]>();
    const request=loader.load('a',()=>old.promise);loader.invalidate();old.resolve(['stale']);await request;
    expect(seen).toHaveLength(1);
    await loader.load('a',()=>Promise.resolve(['fresh']));expect(seen.at(-1)?.status).toBe('success');
  });
});
