import fs from 'node:fs';
import crypto from 'node:crypto';
import {inspectClassification} from './scripts/agents/workstream-classification-watch.mjs';
import {readField} from './scripts/agents/agent-wip-policy.mjs';
const root=process.env.RECONCILIATION_ROOT;
if(!root) throw new Error('RECONCILIATION_ROOT required');
const report=JSON.parse(fs.readFileSync(root+'/capture/observation.json'));
const items=JSON.parse(fs.readFileSync(root+'/capture/items.json'));
const by=new Map(items.map(i=>[i.number,i]));
const plans=[]; const diffs=[]; const exceptions=[];
const productMissing=new Set([47,15,8,31,13,1,120,50,7,32,12,19,118,66,40,6,44,221,45,413,242,241,238,27,34,218,246,495,494,493,492,491,490,489,471,428]);
const activeLabels=new Set(['state:active','candidate:active','state:reserve-ready','state:ready-for-promotion']);
const fieldsAllowed=new Set(['LANE_STATE','ACTIVE_CANDIDATE','WORKSTREAM','AGENT_LANE','ASTRA_RISK','FINAL_RISK_POLICY']);
for (const finding of report.findings) {
  const i=by.get(finding.number); const old=String(i.body||''); let body=old;
  const edits=[]; const changes=[]; let ws=finding.workstream;
  function prepend(text){edits.push(['PREPEND',text]);body=text+body;}
  function replaceOnce(from,to){if(body.split(from).length!==2)throw new Error('not unique '+i.number+':'+JSON.stringify(from));edits.push(['REPLACE',from,to]);body=body.replace(from,to);}
  function setField(field,value){
    if(!fieldsAllowed.has(field))throw new Error('field forbidden');
    const prior=readField(body,field); if(prior===value)return;
    if(prior.includes('|'))throw new Error('ambiguous '+field);
    if(!prior){prepend(field+': '+value+'\n'); changes.push({field,old:null,new:value});return;}
    const exp=new RegExp('^([ \\t]*[-*]?[ \\t]*'+field+'[ \\t]*:[ \\t]*)(.*?)([ \\t]*)$','gmi');
    const candidates=[...body.matchAll(exp)].filter(m=>m[2].trim()===prior);
    if(candidates.length!==1)throw new Error('ambiguous raw '+field+' '+candidates.length);
    replaceOnce(candidates[0][0],candidates[0][1]+value+candidates[0][3]);
    if(readField(body,field)!==value)throw new Error('not real declaration');
    changes.push({field,old:prior,new:value});
  }
  try {
    if(ws==='INVALID') {
      if(i.number===478){replaceOnce('## Workstream\n','## 分類管理\n');ws='MODEL_GOVERNANCE';changes.push({field:'duplicate-heading',old:'## Workstream',new:'## 分類管理'});}
      else if(productMissing.has(i.number)){prepend('WORKSTREAM: PRODUCT_MAINLINE\n\n');ws='PRODUCT_MAINLINE';changes.push({field:'WORKSTREAM',old:null,new:ws});}
      else throw new Error('requires semantic triage');
    }
    if(i.number===516){
      ws='MODEL_GOVERNANCE';setField('WORKSTREAM',ws);setField('FINAL_RISK_POLICY','NOT_REQUIRED_BY_OWNER_POLICY');
    }
    if(i.kind==='PR'&&ws==='MODEL_GOVERNANCE'){
      if(finding.errors.some(e=>e.includes('requires AGENT_LANE')))setField('AGENT_LANE','GOVERNANCE');
      if(finding.errors.some(e=>e.includes('requires ASTRA_RISK')))setField('ASTRA_RISK','NONE');
      if(finding.errors.some(e=>e.includes('requires FINAL_RISK_POLICY')))setField('FINAL_RISK_POLICY','NOT_REQUIRED_BY_OWNER_POLICY');
    }
    if(i.state==='closed') {
      if(finding.errors.includes('CLOSED_ITEM_ACTIVE_FIELD:LANE_STATE'))setField('LANE_STATE',i.kind==='PR'&&i.merged===true?'COMPLETE':'HISTORICAL');
      if(finding.errors.includes('CLOSED_ITEM_ACTIVE_FIELD:ACTIVE_CANDIDATE'))setField('ACTIVE_CANDIDATE','false');
    }
    const expected='workstream:'+ (ws==='MODEL_GOVERNANCE'?'model-governance':'product-mainline');
    const remove=i.labels.filter(l=>(l.startsWith('workstream:')&&l!==expected)||(i.state==='closed'&&activeLabels.has(l)));
    // The classifier owns its warning label. Remove it only after this same classifier accepts the proposed state.
    if(i.labels.includes('governance:workstream-incomplete'))remove.push('governance:workstream-incomplete');
    const add=[];
    if(!i.labels.includes(expected))add.push(expected);
    if(i.kind==='PR'&&i.state==='closed'&&remove.some(l=>activeLabels.has(l))) {
      const terminal=i.merged?'state:complete':'state:historical';
      if(!i.labels.includes(terminal))add.push(terminal);
    }
    if(edits.length){
      const note='\n\n> #528 狀態對帳（2026-09-17）：僅補齊本項現行分類／工作位置。原始本文與逐欄 OLD/NEW 已存於本輪對帳紀錄。未改寫既有 review、CI、合併／關閉時間；不新增產品出貨、TEST／Production 驗收或父 Issue 完成宣稱。\n';
      edits.push(['APPEND',note]);body+=note;
    }
    const after={...i,body,labels:[...i.labels.filter(l=>!remove.includes(l)),...add]};
    const result=inspectClassification(after,i.files);
    if(result.status!=='PASS'&&result.status!=='LEGACY_GRANDFATHERED')throw new Error('proposed validation failed:'+JSON.stringify(result.errors));
    if(i.kind==='PR'&&i.state==='open'&&edits.length)throw new Error('open Product source/metadata edits forbidden in batch');
    if(!edits.length&&!add.length&&!remove.length)throw new Error('no-op');
    const plan={n:i.number,k:i.kind,s:i.state,h:i.bodySha256,head:i.head?.sha??null,base:i.base?.sha??null,edits,add,remove,ws};
    plans.push(plan);
    diffs.push({number:i.number,kind:i.kind,url:i.url,originalBodyHash:i.bodySha256,updatedBodyHash:crypto.createHash('sha256').update(body).digest('hex'),state:i.state,merged:i.merged,changes,labels:{old:i.labels,new:after.labels,add,remove},finding:finding.errors,reason:productMissing.has(i.number)?'依實際議題功能範圍／PR完整修改檔案及相依同步用途補分類，不以父Issue推斷':i.number===516?'完整差異僅兩份docs/metrics，應為治理；保留歷史模型與review紀錄':'現行宣告／實際檔案與GitHub真實開關狀態對帳',validation:result});
  } catch(e){exceptions.push({number:i.number,error:e.message});}
}
fs.writeFileSync(root+'/metadata-plan.json',JSON.stringify({version:1,policySha:report.policySha,observedAt:report.observedAt,sourceRun:35183172330,plans},null,2)+'\n');
fs.writeFileSync(root+'/metadata-diffs.json',JSON.stringify(diffs,null,2)+'\n');
fs.writeFileSync(root+'/metadata-plan-exceptions.json',JSON.stringify(exceptions,null,2)+'\n');
if(exceptions.length||plans.length!==101)throw new Error('Reviewed inventory changed');
console.log('plans',plans.length,'exceptions',exceptions);
console.log('bodyEdits',plans.filter(p=>p.edits.length).length,'labelChanges',plans.filter(p=>p.add.length||p.remove.length).length,'kinds',plans.reduce((a,p)=>(a[p.k]=(a[p.k]||0)+1,a),{}));
console.log('Before/after verified by existing inspectClassification, files complete.');
