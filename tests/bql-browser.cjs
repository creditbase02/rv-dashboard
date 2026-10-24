/* Focused BQL UI regression; all market and publishing services are mocked. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {execFileSync}=require('node:child_process');
const base=process.argv.slice(2).find(arg=>arg!=='--')||'http://127.0.0.1:8766/';
const token='a'.repeat(64);
(async()=>{
 const temp=mkdtempSync(join(tmpdir(),'bql-ui-'));
 const browser=await chromium.launch();
 try{
  const fixture=join(temp,'comparison.xlsx');
  execFileSync(process.platform==='win32'?'python':'python3',['tests/make_luac_fixture.py','--out',fixture,'--date','2026-10-16']);
  for(const width of [1440,375]){
   const context=await browser.newContext({viewport:{width,height:1000}});
   const page=await context.newPage();
   const errors=[]; page.on('pageerror',e=>errors.push(e.message));
   const requests=[];
   await context.route('**/assets/luac-bonds.json',route=>{
    const data=JSON.parse(readFileSync('assets/luac-bonds.json','utf8'));
    data.date='2026-10-15';data.records=data.records.slice(0,40);
    return route.fulfill({json:data});
   });
   await context.route('**/assets/upload-config.json',route=>route.fulfill({json:{enabled:false,luac_enabled:false,supply_enabled:false,api_url:'https://upload.invalid'}}));
   await context.route('https://upload.invalid/**',route=>{requests.push(route.request().url());return route.abort();});
   await context.route('http://127.0.0.1:8768/**',route=>{
    const request=route.request(); const path=new URL(request.url()).pathname;
    const headers={'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    assert.equal(request.headers().authorization,`Bearer ${token}`);
    if(path==='/health')return route.fulfill({headers,json:{ready:true}});
    requests.push(path);
    assert.equal(path,'/probe');
    const body=request.postDataJSON(); assert.deepEqual(Object.keys(body),['data']);
    assert.equal(body.data.records.length,40);
    const current=JSON.parse(readFileSync('assets/luac-bonds.json','utf8'));
    assert.deepEqual(body.data.peer_definitions,current.peer_definitions);
    return route.fulfill({headers,json:{passed:true,date_match:true,count:40,required_field_coverage_pct:100}});
   });
   await page.goto(`${base}update.html#bbg-token=${token}`);
   await page.locator('#bloomberg-status.success').waitFor();
   assert.deepEqual(requests,[],'health must not trigger a market query');
   await page.locator('#luac-file').setInputFiles(fixture);
   await page.locator('#validate-luac').click();
   await page.locator('#luac-validation-status.success').waitFor();
   assert.equal(await page.locator('#probe-bloomberg').isDisabled(),true);
   await page.locator('#bloomberg-session-confirm').check();
   assert.equal(await page.locator('#probe-bloomberg').isEnabled(),true);
   await page.locator('#probe-bloomberg').click();
   await page.locator('#bloomberg-status.success').filter({hasText:'比對通過'}).waitFor();
   assert.deepEqual(requests,['/probe'],'diagnostic must not call publishing services');
   await page.locator('#clear-luac').click();
   assert.equal(await page.locator('#bloomberg-session-confirm').isChecked(),false);
   assert.equal(await page.locator('#probe-bloomberg').isDisabled(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   await context.close();
  }
  const page=await browser.newPage();
  await page.route('http://127.0.0.1:8768/**',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':new URL(base).origin},json:{ready:false,error_class:'bql_runtime_unavailable'}}));
  await page.goto(`${base}update.html#bbg-token=${token}`);
  await page.locator('#bloomberg-status.error').waitFor();
  assert.match(await page.locator('#bloomberg-status').innerText(),/找不到 Bloomberg BQL Python/);
  assert.equal(await page.locator('#probe-bloomberg').isDisabled(),true);
  console.log('BQL UI PASS: desktop/mobile, environment failure, explicit trigger, confirmation reset, no publishing');
 }finally{await browser.close();rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
