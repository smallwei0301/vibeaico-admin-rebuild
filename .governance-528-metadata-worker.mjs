import crypto from 'node:crypto';
import {inspectClassification} from './scripts/agents/workstream-classification-watch.mjs';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const labelNames=i=>(i.labels||[]).map(l=>typeof l==='string'?l:l.name);
const filesKey=rows=>JSON.stringify((rows||[]).map(f=>[f.filename,f.previous_filename||null,f.status,f.sha]).sort((a,b)=>a[0].localeCompare(b[0])));
export function propose(current,files,plan,original){
  const isPr=plan.k==='PR';
  if(current.number!==plan.n||current.state!==plan.s||digest(current.body||'')!==plan.h||(current.head?.sha??null)!==plan.head||(current.base?.sha??null)!==plan.base)throw new Error('ITEM_CHANGED_SINCE_REVIEW');
  if(isPr&&(filesKey(files)!==filesKey(original.files)||current.changed_files!==original.changed_files))throw new Error('FILE_SCOPE_CHANGED_SINCE_REVIEW');
  if(isPr&&current.state==='open'&&plan.edits.length)throw new Error('OPEN_PRODUCT_BODY_WRITE_FORBIDDEN');
  let body=current.body||'';
  for(const [op,a,b] of plan.edits){
    if(op==='PREPEND')body=a+body;
    else if(op==='APPEND')body+=a;
    else if(op==='REPLACE'){
      if(body.split(a).length!==2)throw new Error('REPLACEMENT_NOT_UNIQUE');
      body=body.replace(a,b);
    }else throw new Error('INVALID_EDIT');
  }
  const existing=labelNames(current);
  const labels=[...existing.filter(n=>!plan.remove.includes(n)),...plan.add.filter(n=>!existing.includes(n))];
  const proposed={...current,body,labels};
  const result=inspectClassification(proposed,files);
  if(!['PASS','LEGACY_GRANDFATHERED'].includes(result.status)||result.workstream!==plan.ws)throw new Error('PROPOSAL_REJECTED');
  return {body,labels,result,bodyHash:digest(body)};
}
export function verifyAfter(before,after,files,plan,proposal){
  if(before.number!==after.number||before.state!==after.state||before.state_reason!==after.state_reason||before.merged!==after.merged||before.merged_at!==after.merged_at||before.closed_at!==after.closed_at||before.head?.sha!==after.head?.sha||before.base?.sha!==after.base?.sha)throw new Error('LIFECYCLE_OR_SOURCE_CHANGED_DURING_APPLY');
  if(digest(after.body||'')!==proposal.bodyHash)throw new Error('BODY_CHANGED_DURING_APPLY');
  const result=inspectClassification(after,files);
  if(!['PASS','LEGACY_GRANDFATHERED'].includes(result.status)||result.workstream!==plan.ws)throw new Error('READBACK_REJECTED');
  const protectedLabels=labelNames(before).filter(n=>!plan.remove.includes(n));
  if(protectedLabels.some(n=>!labelNames(after).includes(n)))throw new Error('UNRELATED_LABEL_CHANGED');
  return result;
}
