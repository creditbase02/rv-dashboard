const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const base=process.argv.slice(2).find(arg=>arg!=='--')||'http://127.0.0.1:8766/';
const source=JSON.parse(readFileSync('assets/luac-bonds.json','utf8'));
const current={...source,records:source.records.slice(0,80)};
const candidate={...current,date:'2026-10-28'};
const token='c'.repeat(64),service='https://rv-upload-service.rv-dashboard.workers.dev';
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [1440,768,375]){
   const context=await browser.newContext({viewport:{width,height:1000}});
   const page=await context.newPage();const errors=[];const publishes=[];let queries=0,qualified=false,failQuery=false;
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/assets/luac-bonds.json*',route=>route.fulfill({json:current}));
   await context.route('http://127.0.0.1:8768/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const headers={'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    assert.equal(request.headers().authorization,'Bearer '+token);
    if(path==='/health')return route.fulfill({headers,json:{ready:true,preview_enabled:true,api_qualified:qualified}});
    assert.equal(path,'/preview');assert.deepEqual(request.postDataJSON(),{});queries++;
    if(failQuery)return route.fulfill({headers,json:{ok:false,error_class:'query_timeout'}});
    return route.fulfill({headers,json:{ok:true,validation:'schema_only',comparison:'not_verified',api_qualified:qualified,data:candidate}});
   });
   await context.route(service+'/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/session'){
     assert.deepEqual(request.postDataJSON(),{password:'test-password'});
     return route.fulfill({json:{token:'upload-session'}});
    }
    assert.equal(request.headers().authorization,'Bearer upload-session');
    if(path==='/publish/luac'){
     const body=request.postDataJSON();publishes.push(body);
     assert.deepEqual(Object.keys(body),['data']);assert.deepEqual(body.data,candidate);
     assert.equal(JSON.stringify(body).includes(token),false);
     return route.fulfill({json:{id:123}});
    }
    assert.equal(path,'/status/luac/123');return route.fulfill({json:{state:'deployed',message:'API 資料已部署'}});
   });
   await page.goto(base+'bonds.html#bbg-token='+token);
   await page.locator('#api-connection.connected').waitFor();
   assert.equal(queries,0,'loading main page never queries Bloomberg');
   assert.equal(await page.locator('#bond-total').innerText(),'80 檔債券');
   assert.match(await page.locator('#api-qualification-status').innerText(),/尚未完成/);
   assert.equal(await page.locator('#api-qualification').getAttribute('href'),'update.html#bbg-token='+token);
   await page.locator('#api-fetch').click();await page.locator('#api-status.success').waitFor();
   assert.equal(queries,1);assert.equal(await page.locator('#api-date').innerText(),'2026-10-28');
   await page.locator('#api-confirm').check();await page.locator('#api-password').fill('test-password');
   assert.equal(await page.locator('#api-publish').isDisabled(),true,'unqualified API cannot publish');
   qualified=true;
   await page.locator('#api-check').click();await page.waitForFunction(()=>document.getElementById('api-qualification-status').textContent.includes('已完成'));
   failQuery=true;
   await page.locator('#api-fetch').click();await page.locator('#api-status.error').waitFor();
   assert.match(await page.locator('#api-status').innerText(),/保留先前資料/);
   assert.equal(await page.locator('.bond-date time').innerText(),'2026/10/28');
   assert.equal(await page.locator('#api-confirm').isChecked(),false);
   assert.equal(await page.locator('#api-publish').isDisabled(),true);
   assert.equal(queries,2,'failed market queries never retry');
   failQuery=false;
   await page.locator('#api-fetch').click();await page.locator('#api-status.success').waitFor();
   assert.equal(await page.locator('#api-publish').isDisabled(),true,'each snapshot needs a fresh confirmation');
   await page.locator('#api-confirm').check();await page.locator('#api-publish').click();
   await page.locator('#api-snapshot-state').filter({hasText:'已發布'}).waitFor();
   assert.equal(publishes.length,1);assert.equal(queries,3);
   assert.match(await page.locator('#bond-source').innerText(),/已發布 API/);
   assert.equal(await page.locator('#api-password').inputValue(),'');
   assert.equal(await page.locator('#api-publish').isDisabled(),true,'completed publication is not resubmitted');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}: overflow`);
   assert.deepEqual(errors,[]);
   if(width===1440)await page.screenshot({path:'/tmp/rv-api-production-desktop.png',fullPage:false});
   if(width===375)await page.screenshot({path:'/tmp/rv-api-production-mobile.png',fullPage:false});
   await context.close();
  }
  const context=await browser.newContext();const page=await context.newPage();let requests=0;
  await context.route('**/assets/luac-bonds.json*',route=>route.fulfill({json:current}));
  await context.route('http://127.0.0.1:8768/**',route=>{requests++;return route.abort();});
  await page.goto(base+'bonds.html');await page.waitForFunction(()=>document.getElementById('api-status').textContent.includes('Start.cmd'));
  assert.equal(requests,0);assert.equal(await page.locator('#api-fetch').isDisabled(),true);
  assert.equal(await page.locator('#bond-total').innerText(),'80 檔債券');await context.close();
  console.log('Production API PASS: qualification gate, explicit query and publish, failed-query retention, confirmation reset, sanitized Worker payload, desktop/tablet/mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
