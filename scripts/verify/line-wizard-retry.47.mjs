// SOURCE_ONLY browser harness: actual wizard with stub services; never calls LINE/DB.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const repo = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'wizard47-'));
const webpackModule = require('next/dist/compiled/webpack/webpack');
webpackModule.init();
const webpack = webpackModule.webpack;
writeFileSync(join(dir, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText}`);
writeFileSync(join(dir, 'link.tsx'), `import React from 'react';export default function Link(p:any){return <a {...p}/>}`);
writeFileSync(join(dir, 'env.ts'), `export const APP_URL='http://example.test';`);
writeFileSync(join(dir, 'services.ts'), `import {DEFAULT_TENANT_SETTINGS} from '${repo}/src/config/tenant-settings';
window.fixture={loadFails:true,verifyMode:'pass',pending:null,loads:0,verifies:0};
export async function getTenantSettings(){window.fixture.loads++;if(window.fixture.loadFails)throw Error('設定暫時無法讀取');const s=DEFAULT_TENANT_SETTINGS('demo','測試');s.line.channelId='123';s.line.channelSecret='masked';s.line.channelAccessToken='masked';return s;}
export async function verifyLineSetup(){window.fixture.verifies++;if(window.fixture.verifyMode==='error')throw Error('LINE 檢查逾時');if(window.fixture.verifyMode==='pending')await new Promise(r=>window.fixture.pending=r);return {checks:['CREDENTIALS','TOKEN','ID_SECRET_PAIR','BOT_MODE','WEBHOOK','WEBHOOK_TEST'].map(key=>({key,status:'PASS',pass:true,message:key})).concat([{key:'AUTO_REPLY',status:'INFO',pass:false,message:'人工確認'}])};}
export async function saveLineSettings(){return {};}
export async function syncLineWebhook(){throw Error('Provider writes disabled in harness');}`);
writeFileSync(join(dir, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${repo}/src/app/tenant/line-settings/onboarding/page';import {ToastProvider} from '${repo}/src/components/ui/Toast';createRoot(document.getElementById('root')!).render(<ToastProvider><Page/></ToastProvider>);`);
let server, browser;
try {
  await new Promise((ok, bad) => webpack({mode:'development',entry:join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(repo,'node_modules')],alias:{'@/services/settings':join(dir,'services.ts'),'@/config/env':join(dir,'env.ts'),'next/link':join(dir,'link.tsx'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:join(dir,'loader.cjs')}]},devtool:false},(e,s)=>e||s.hasErrors()?bad(e||s.toString({all:false,errors:true})):ok()));
  const cssDir=resolve(repo,'.next/static/css');
  const css=readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>readFileSync(join(cssDir,f),'utf8')).join('\n');
  server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':req.url==='/style.css'?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?readFileSync(join(dir,'bundle.js')):req.url==='/style.css'?css:'<html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root" style="padding:16px"></div><script src="/bundle.js"></script></body></html>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('讀取設定失敗：設定暫時無法讀取').waitFor();
  await page.evaluate(()=>window.fixture.loadFails=false);
  await page.getByRole('button',{name:'重新讀取設定'}).click();
  await page.getByText('第五步：手動確認一件事（LINE 沒有開放系統自動檢查）').waitFor();
  await page.getByRole('button',{name:'上一步',exact:true}).click();
  await page.evaluate(()=>window.fixture.verifyMode='pending');
  await page.getByRole('button',{name:'開始測試'}).click();
  await page.getByRole('button',{name:'下一步',exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'下一步',exact:true}).isDisabled())throw Error('pending allowed advance');
  await page.evaluate(()=>window.fixture.pending());
  await page.waitForFunction(()=>document.body.innerText.includes('WEBHOOK_TEST'));
  await page.evaluate(()=>window.fixture.verifyMode='error');
  await page.getByRole('button',{name:'開始測試'}).click();
  await page.getByText('檢查失敗：LINE 檢查逾時').waitFor();
  if(!await page.getByRole('button',{name:'下一步',exact:true}).isDisabled())throw Error('failed retry preserved PASS');
  await page.evaluate(()=>window.fixture.verifyMode='pass');
  await page.getByRole('button',{name:'重新檢查',exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes('檢查失敗：LINE 檢查逾時'));
  if(await page.getByRole('button',{name:'下一步',exact:true}).isDisabled())throw Error('recovery did not unlock');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>390))throw Error('390px overflow');
  if(process.env.BROWSER_SCREENSHOT)await page.screenshot({path:process.env.BROWSER_SCREENSHOT,fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: settings error/retry; stale PASS invalidation; pending/failure blocked; recovery; 390px; no page errors. SOURCE_ONLY stub services.');
} finally {await browser?.close();await new Promise(r=>server?server.close(r):r());rmSync(dir,{recursive:true,force:true});}
