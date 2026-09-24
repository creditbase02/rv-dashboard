const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,readFileSync,rmSync,writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');

const FORECAST_MANIFEST='https://creditbase02.github.io/ib-knowledge-base/integration-manifest.json';
const FORECAST_FEED='https://creditbase02.github.io/ib-knowledge-base/forecast-calls.json';
const forecastCalls=[
  {broker:'BofA',asset:'US IG',type:'Overweight Sector',call:'Utilities',target_date:'',call_date:'2026-09-11',as_of_date:'2026-09-18',status:'Carried',note:'Sector view',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/'},
  {broker:'BofA',asset:'US IG',type:'Underweight Sector',call:'Health Care',target_date:'',call_date:'2026-09-11',as_of_date:'2026-09-18',status:'Carried',note:'Sector view',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/'},
  {broker:'BofA',asset:'US IG',type:'Gross Supply',call:'$2.1Tn',target_date:'2026',call_date:'2026-08-14',as_of_date:'2026-09-18',status:'Carried',note:'Annual forecast',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/'},
  {broker:'BofA',asset:'US IG',type:'Gross Supply',call:'$190Bn',target_date:'2026-09',call_date:'2026-09-04',as_of_date:'2026-09-18',status:'Carried',note:'Monthly forecast',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/'},
  {broker:'BofA',asset:'US IG',type:'Hyperscaler Issuance',call:'$330Bn',target_date:'2026',call_date:'2026-09-18',as_of_date:'2026-09-18',status:'Latest',note:'Annual forecast',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/'},
  {broker:'GS',asset:'US IG',type:'Gross Supply',call:'$2.3Tn',target_date:'2026',call_date:'2026-09-11',as_of_date:'2026-09-18',status:'Carried',note:'Annual forecast',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/gs/'},
];
const forecastFeed={schema_version:1,site_id:'ib-knowledge-base',content_as_of:'2026-09-18',reference_year:2026,source_url:'https://creditbase02.github.io/ib-knowledge-base/forecast/',calls:forecastCalls};
const forecastManifest={schema_version:1,site_id:'ib-knowledge-base',production_url:'https://creditbase02.github.io/ib-knowledge-base/',validation_status:'PASS',datasets:{forecast:{asset:'forecast-calls.json',schema_version:1,content_as_of:'2026-09-18',sha256:'a'.repeat(64)}}};
async function routeForecast(page,{missing=false,feedStatus=200}={}){
  await page.route(`${FORECAST_MANIFEST}*`,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(missing?{...forecastManifest,datasets:{}}:forecastManifest)}));
  await page.route(`${FORECAST_FEED}*`,route=>route.fulfill({status:feedStatus,contentType:'application/json',body:feedStatus===200?JSON.stringify(forecastFeed):'{}'}));
}

async function run(browser, base, width = 1440) {
  const context = await browser.newContext({viewport:{width,height:1000},hasTouch:width<650});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400) errors.push(`${r.status()} ${r.url()}`);});
  await routeForecast(page);
  await page.goto(base);
  await page.waitForSelector('.rv-point');
  assert.equal(await page.locator('[name=section]:checked').inputValue(),'Overview');
  assert.deepEqual(await page.locator('[name=metric]:checked').evaluateAll(es=>es.map(e=>e.value)),['Spread']);
  const metrics = ['Spread','10Y','30Y','10s30s'];
  const data = await (await page.request.get(base+'assets/rv-data.json')).json();
  let combinations = 0;
  for(const section of ['Overview','Cyclical','Non-Cyclical']) {
    await page.locator(`[name=section][value="${section}"]`).check();
    for(let mask=0;mask<16;mask++) {
      for(const metric of metrics) await page.locator(`[name=metric][value="${metric}"]`).setChecked(false);
      for(let index=0;index<4;index++) await page.locator(`[name=metric][value="${metrics[index]}"]`).setChecked(Boolean(mask&(1<<index)));
      const expected = mask&8 ? ['10s30s'] : metrics.filter((_,index)=>mask&(1<<index));
      assert.deepEqual(await page.locator('[name=metric]:checked').evaluateAll(es=>es.map(e=>e.value)),expected);
      assert.equal(await page.locator('.rv-chart').count(),mask ? 1 : 0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${section}/${mask} overflow`);
      combinations++;
    }
    for(const metric of metrics) {
      for(const option of metrics) await page.locator(`[name=metric][value="${option}"]`).setChecked(false);
      await page.locator(`[name=metric][value="${metric}"]`).check();
      const points = page.locator(`.rv-point[data-metric="${metric}"]`);
      assert.equal(await points.count(),data.sections[section][metric].length*5);
      assert.equal(await page.locator(`polygon.rv-range-arrow[data-metric="${metric}"][data-field="min"]`).count(),data.sections[section][metric].length);
      assert.equal(await page.locator(`polygon.rv-range-arrow[data-metric="${metric}"][data-field="max"]`).count(),data.sections[section][metric].length);
      assert.equal(await page.locator(`line.rv-range-line`).count(),data.sections[section][metric].length);
      assert.equal(await page.locator(`rect.rv-median-marker[data-metric="${metric}"]`).count(),data.sections[section][metric].length);
      assert.equal(await page.locator(`polygon.rv-current-marker[data-metric="${metric}"]`).count(),data.sections[section][metric].length);
      assert.equal(await page.locator('.range-value-label,.current-value-label').count(),0);
      assert.equal(await page.locator('.percentile-value-label').count(),data.sections[section][metric].length);
      const currentPoints=(await page.locator(`polygon.rv-current-marker[data-metric="${metric}"]`).first().getAttribute('points')).trim().split(/\s+/).map(pair=>Number(pair.split(',')[0]));
      assert.equal(currentPoints[0]+currentPoints[1],currentPoints[2]*2,'current marker is horizontally centered');
      for(const field of ['min','max']) {
        await page.locator(`.rv-point[data-metric="${metric}"][data-field="${field}"]`).first().focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#rv-tooltip').isVisible(),true);
        const row=data.sections[section][metric][0],tooltip=await page.locator('#rv-tooltip').innerText();
        assert.match(tooltip,/2Y Min–Max/);
        assert.ok(tooltip.includes(new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(row.min)));
        assert.ok(tooltip.includes(new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(row.max)));
        await page.keyboard.press('Escape');
      }
    }
    for(const option of metrics) await page.locator(`[name=metric][value="${option}"]`).setChecked(false);
    await page.locator('[name=metric][value="Spread"]').check();
    await page.locator('[name=metric][value="10Y"]').check();
    assert.equal(await page.locator('.percentile-value-label').count(),data.sections[section].Spread.length*2);
    assert.equal(await page.locator('.percentile-value-label.compact').count(),data.sections[section].Spread.length*2);
    assert.equal(await page.locator('.range-value-label,.current-value-label').count(),0);
  }
  const peerHref = await page.getByRole('link',{name:'返回券商報告知識庫'}).getAttribute('href');
  assert.equal(peerHref,'https://creditbase02.github.io/ib-knowledge-base/');
  await page.locator('[data-forecast-view=sectors]:not([hidden])').waitFor();
  assert.equal(await page.locator('.forecast-broker-card').count(),1);
  assert.match(await page.locator('.forecast-broker-card').innerText(),/Utilities/);
  assert.match(await page.locator('.forecast-broker-card').innerText(),/Health Care/);
  assert.deepEqual(errors,[]);
  await context.close();
  return {width,combinations};
}

async function runBonds(browser,base,width=1440){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<650});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await page.goto(base+'bonds.html');
  await page.waitForSelector('#bond-rows tr');
  const data=await (await page.request.get(base+'assets/luac-bonds.json')).json();
  const model=require('../assets/luac-model.js');
  assert.equal(await page.locator('[name=bond-metric]:checked').inputValue(),'yield_pct');
  assert.equal(await page.locator('#chart-title').innerText(),'Maturity × Yield');
  assert.equal(await page.locator('#bond-rows tr').count(),50);
  const uncheckedRatings=await page.locator('#rating-filter input:not(:checked)').evaluateAll(inputs=>inputs.map(input=>input.value));
  const checkedRatings=await page.locator('#rating-filter input:checked').evaluateAll(inputs=>inputs.map(input=>input.value));
  assert.ok(uncheckedRatings.length>0);
  assert.ok(uncheckedRatings.every(rating=>['BB','NR'].includes(model.ratingBand(rating))));
  assert.ok(checkedRatings.every(rating=>['AAA','AA','A','BBB'].includes(model.ratingBand(rating))));
  assert.deepEqual(await page.locator('#bond-canvas').evaluate(canvas=>[Number(canvas.dataset.xMin),Number(canvas.dataset.xMax)]),[0,50]);
  assert.equal(await page.locator('#issuer-filter').count(),0);
  assert.equal(await page.locator('#curve-group option[value=ticker]').count(),0);
  assert.deepEqual(await page.locator('.filter-card').evaluateAll(cards=>cards.map(card=>card.dataset.filter)),['rating','industry','ticker']);
  assert.equal(await page.locator('#industry-filter-title').innerText(),'產業');
  assert.equal(await page.locator('[name=industry-dimension][value=industry]').isChecked(),true);
  assert.equal(await page.locator('#curve-group option[value=peer_group]').count(),1);
  assert.equal(await page.locator('#point-group option[value=peer_group]').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/bonds overflow`);

  if(width===1440){
    const industryHandle=page.locator('.filter-card[data-filter=industry] .drag-handle'),ratingCard=page.locator('.filter-card[data-filter=rating]');
    const handleBox=await industryHandle.boundingBox(),ratingBox=await ratingCard.boundingBox();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();
    await page.mouse.move(ratingBox.x+ratingBox.width/2,ratingBox.y+2,{steps:6});await page.mouse.up();
    assert.deepEqual(await page.locator('.filter-card').evaluateAll(cards=>cards.map(card=>card.dataset.filter)),['industry','rating','ticker']);
    await page.locator('#reset-filters').click();
    await page.locator('.filter-card[data-filter=ticker] [data-filter-move=up]').click();
    assert.deepEqual(await page.locator('.filter-card').evaluateAll(cards=>cards.map(card=>card.dataset.filter)),['rating','ticker','industry']);
    await page.locator('#reset-filters').click();

    const exactRating=data.records.map(record=>record[5]).find(rating=>model.ratingBand(rating)==='A');
    assert.ok(exactRating);
    await page.locator('[data-filter-action=none][data-filter=rating]').click();
    await page.locator('#rating-filter input').evaluateAll((inputs,value)=>inputs.find(input=>input.value===value).click(),exactRating);
    const matching=data.records.filter(record=>record[5]===exactRating),industries=[...new Set(matching.map(record=>record[9]))].sort(),tickers=[...new Set(matching.map(record=>record[3]))].sort();
    assert.deepEqual((await page.locator('#industry-filter input').evaluateAll(inputs=>inputs.map(input=>input.value))).sort(),industries);
    assert.deepEqual((await page.locator('#ticker-filter input').evaluateAll(inputs=>inputs.map(input=>input.value))).sort(),tickers);
    assert.ok((await page.locator('#bond-rows tr td:nth-child(5)').allInnerTexts()).every(rating=>rating===exactRating));

    await page.locator('#point-group').selectOption('industry');
    assert.equal(await page.locator('#point-group').inputValue(),'band');
    assert.match(await page.locator('#grouping-notice').innerText(),/1–10/);
    await page.locator('#reset-filters').click();

    const mappedTickers=new Set(data.peer_definitions.flatMap(definition=>definition.tickers));
    const mappedRecords=data.records.filter(record=>mappedTickers.has(record[3]));
    const inBands=record=>['AAA','AA','A','BBB'].includes(model.ratingBand(record[5]));
    const expectedPeerVisible=mappedRecords.filter(inBands).length,unmapped=data.records.length-mappedRecords.length;
    await page.locator('[name=industry-dimension][value=peer_group]').check();
    assert.equal(await page.locator('#industry-filter-title').innerText(),'Peer Group');
    assert.equal(await page.locator('#point-group').inputValue(),'ticker','Peer Group mode must default the point colours to Ticker');
    assert.equal(await page.locator('#curve-group').inputValue(),'peer_group','Peer Group mode must default the curve classification to Peer Group');
    assert.match(await page.locator('#grouping-notice').innerText(),/點位顏色預設為 Ticker、曲線分類預設為 Peer Group/);
    assert.match(await page.locator('#curve-legend').innerText(),/點位顏色｜Ticker/);
    assert.match(await page.locator('#curve-legend').innerText(),/回歸曲線｜Peer Group/);
    assert.deepEqual((await page.locator('#industry-filter input').evaluateAll(inputs=>inputs.map(input=>input.value))).sort(),data.peer_definitions.map(definition=>definition.name).sort());
    const peerStatus=await page.locator('#bond-status').innerText();
    assert.ok(peerStatus.includes(`顯示 ${expectedPeerVisible.toLocaleString('en-US')} 檔`),peerStatus);
    assert.ok(peerStatus.includes(`排除 ${unmapped.toLocaleString('en-US')} 檔未分類`),peerStatus);
    assert.match(await page.locator('#chart-subtitle').innerText(),/Peer Group 模式只顯示已分類債券/);
    const peerName=data.peer_definitions[0].name,peerTickers=new Set(data.peer_definitions[0].tickers);
    await page.locator(`#industry-filter input[value="${peerName}"]`).check();
    const peerRows=(await page.locator('#bond-rows tr td:nth-child(3)').allInnerTexts()).map(value=>value.trim());
    assert.ok(peerRows.length>0);
    assert.ok(peerRows.every(ticker=>peerTickers.has(ticker)),peerRows.join(','));
    assert.equal(peerRows.length,Math.min(50,mappedRecords.filter(record=>peerTickers.has(record[3])&&inBands(record)).length));
    await page.locator('#point-group').selectOption('peer_group');
    assert.equal(await page.locator('#point-group').inputValue(),'peer_group');
    assert.match(await page.locator('#curve-legend').innerText(),/點位顏色與回歸曲線｜Peer Group/);
    assert.equal(await page.locator('#industry-filter-title').innerText(),'Peer Group','selecting Peer Group point colours must follow the Peer Group filter mode');

    await page.locator('[name=industry-dimension][value=industry]').check();
    assert.equal(await page.locator('#industry-filter-title').innerText(),'產業');
    assert.equal(await page.locator('#point-group').inputValue(),'band','leaving Peer Group must restore the previous point colours');
    assert.equal(await page.locator('#curve-group').inputValue(),'band');
    assert.match(await page.locator('#grouping-notice').innerText(),/Peer Group 的勾選已清除/);
    assert.equal(await page.locator('#industry-filter input:checked').count(),0,'leaving Peer Group must forget the peer selection');
    assert.equal((await page.locator('#bond-status').innerText()).includes('未分類'),false,'industry mode must not exclude unmapped bonds');
    const allIndustries=[...new Set(data.records.filter(inBands).map(record=>record[9]))].sort();
    assert.deepEqual((await page.locator('#industry-filter input').evaluateAll(inputs=>inputs.map(input=>input.value))).sort(),allIndustries,'industry mode must list every industry again');
    const onlyIndustry=allIndustries[0];
    await page.locator(`#industry-filter input[value="${onlyIndustry}"]`).check();
    assert.equal(await page.locator('#bond-rows tr td:nth-child(5)').count()>0,true);
    assert.equal((await page.locator('#bond-rows tr').count()),Math.min(50,data.records.filter(record=>inBands(record)&&record[9]===onlyIndustry).length),'switching back to 產業 must apply the industry filter alone');
    await page.locator('#reset-filters').click();
    assert.equal(await page.locator('#industry-filter-title').innerText(),'產業');
    assert.equal(await page.locator('[name=industry-dimension][value=industry]').isChecked(),true);
    assert.equal((await page.locator('#bond-status').innerText()).includes('未分類'),false);

    await page.locator('#industry-filter input').first().check();
    await page.locator('#point-group').selectOption('industry');await page.locator('#curve-group').selectOption('industry');
    assert.equal(await page.locator('#point-group').inputValue(),'industry');assert.equal(await page.locator('#curve-group').inputValue(),'industry');
    assert.match(await page.locator('#curve-legend').innerText(),/點位顏色與回歸曲線｜產業/);
    await page.locator('#ticker-filter input').first().check();await page.locator('#point-group').selectOption('ticker');
    assert.equal(await page.locator('#point-group').inputValue(),'ticker');
    const curveLegend=await page.locator('.legend-group').nth(1).innerText();
    assert.match(await page.locator('#curve-legend').innerText(),/點位顏色｜Ticker/);assert.match(curveLegend,/回歸曲線｜產業/);
    const selectedId=await page.locator('#bond-rows tr').first().getAttribute('data-id');await page.locator('#bond-search').fill(selectedId);
    await page.waitForFunction(id=>document.querySelectorAll('#bond-rows tr').length===1&&document.querySelector('#bond-rows tr')?.dataset.id===id,selectedId);
    assert.equal(await page.locator('.legend-group').nth(1).innerText(),curveLegend,'bond search must not change curve population');
    await page.locator('#bond-search').fill('');await page.locator('#ticker-filter input:checked').first().evaluate(input=>input.click());
    assert.equal(await page.locator('#point-group').inputValue(),'band');assert.match(await page.locator('#grouping-notice').innerText(),/已改回信評大類/);
    await page.locator('#reset-filters').click();

    const scrollResult=await page.locator('#ticker-filter').evaluate(container=>{container.scrollTop=120;const input=container.querySelectorAll('input')[15];input.focus({preventScroll:true});const before=container.scrollTop,value=input.value;input.click();return new Promise(resolve=>requestAnimationFrame(()=>resolve({before,after:container.scrollTop,active:document.activeElement?.value,value})));});
    assert.ok(Math.abs(scrollResult.after-scrollResult.before)<=1,'checking a filter must preserve list scroll');
    assert.equal(scrollResult.active,scrollResult.value,'checking a filter must preserve focus');
    await page.locator('#curve-group').selectOption('industry');
    assert.equal(await page.locator('#curve-group').inputValue(),'industry','effective ticker-filtered industries should enable industry curves');
    await page.locator('#curve-source').selectOption('all');
    assert.match(await page.locator('#curve-legend').innerText(),/全樣本/);
    await page.locator('#reset-filters').click();

    const yieldHeader=page.locator('th[data-sort=yield]');
    await yieldHeader.locator('button').click();assert.equal(await yieldHeader.getAttribute('aria-sort'),'descending');
    await yieldHeader.locator('button').click();assert.equal(await yieldHeader.getAttribute('aria-sort'),'ascending');
    const yields=(await page.locator('#bond-rows tr td:nth-child(6)').allInnerTexts()).map(value=>Number(value.replace(/[% ,]/g,'')));
    assert.deepEqual(yields,[...yields].sort((a,b)=>a-b));
    await page.locator('#reset-filters').click();
  }

  let row=page.locator('#bond-rows tr').first();
  await row.focus();
  let tooltip=await page.locator('#bond-tooltip').innerText();
  assert.match(tooltip,/Yield/);
  assert.match(tooltip,/OAS Spread/);
  assert.match(tooltip,/Yield − curve/);
  const residual=(await row.locator('td').nth(7).innerText()).trim();
  if(residual!=='n.a.')assert.ok(tooltip.includes(residual));
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#bond-tooltip').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bond-tooltip').isHidden(),true);

  const hoverRecord=data.records.find(record=>record[6]>2&&record[6]<50&&!record[10].length&&['AAA','AA','A','BBB'].includes(model.ratingBand(record[5]))),hoverId=hoverRecord[0];
  await page.locator('#bond-search').fill(hoverId);
  await page.waitForFunction(id=>document.querySelectorAll('#bond-rows tr').length===1&&document.querySelector('#bond-rows tr')?.dataset.id===id,hoverId);
  await page.locator('#bond-canvas').scrollIntoViewIfNeeded();
  const box=await page.locator('#bond-canvas').boundingBox(),point={x:box.x+66+hoverRecord[6]/50*(box.width-88),y:box.y+24+(box.height-72)/2};
  await page.mouse.move(point.x,point.y);
  await page.locator('#bond-tooltip').waitFor({state:'visible'});
  tooltip=await page.locator('#bond-tooltip').innerText();
  assert.match(tooltip,/Yield/);assert.match(tooltip,/OAS Spread/);
  if(width<650)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bond-tooltip').isHidden(),true);
  await page.locator('#bond-search').fill('');

  await page.locator('[name=bond-metric][value=oas_bp]').check();
  await page.waitForFunction(()=>document.querySelector('#chart-title')?.textContent==='Maturity × OAS Spread');
  row=page.locator('#bond-rows tr').first();await row.focus();tooltip=await page.locator('#bond-tooltip').innerText();
  assert.match(tooltip,/Yield/);assert.match(tooltip,/OAS Spread/);assert.match(tooltip,/OAS Spread − curve/);
  await page.keyboard.press('Escape');

  const anomaly=data.records.find(record=>record[10].length);
  if(anomaly){
    await page.locator('[data-filter-action=all][data-filter=rating]').click();
    await page.locator('#show-outliers').check();
    await page.locator('#bond-search').fill(anomaly[0]);
    await page.waitForFunction(id=>document.querySelectorAll('#bond-rows tr').length===1&&document.querySelector('#bond-rows tr')?.dataset.id===id,anomaly[0]);
    await page.locator('#bond-rows tr').first().focus();tooltip=await page.locator('#bond-tooltip').innerText();
    assert.ok(tooltip.includes(new Intl.NumberFormat('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}).format(anomaly[8])));
    assert.ok(tooltip.includes(new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(anomaly[7])));
    assert.match(tooltip,/資料異常/);
    await page.keyboard.press('Escape');
  }

  await page.locator('#reset-filters').click();
  await page.waitForFunction(()=>document.querySelector('#bond-rows tr'));
  await page.locator('#bond-canvas').hover({position:{x:200,y:200}});
  await page.mouse.wheel(0,-120);
  const zoomedDomain=await page.locator('#bond-canvas').evaluate(canvas=>[Number(canvas.dataset.xMin),Number(canvas.dataset.xMax)]);
  assert.ok(zoomedDomain[0]>=0&&zoomedDomain[1]<=50&&zoomedDomain[1]-zoomedDomain[0]<50);
  await page.locator('#zoom-reset').click();
  assert.deepEqual(await page.locator('#bond-canvas').evaluate(canvas=>[Number(canvas.dataset.xMin),Number(canvas.dataset.xMax)]),[0,50]);
  assert.deepEqual(errors,[]);
  await context.close();
  return {width,bonds:data.records.length};
}

async function runSupply(browser,base,width=1440){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<650});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await routeForecast(page);
  await page.goto(base+'supply.html');
  await page.waitForFunction(()=>document.querySelector('#supply-status')?.textContent.includes('公開聚合快照'));
  const data=await (await page.request.get(base+'assets/supply-data.json')).json();
  assert.equal(await page.locator('#ytd-label').innerText(),`${data.year} YTD Issuance`);
  assert.equal(await page.locator('#mtd-label').innerText(),`${data.year} MTD Issuance`);
  assert.equal(await page.locator('#row-count').innerText(),data.row_count.toLocaleString('en-US'));
  const billion=value=>Math.round(value/1e9).toLocaleString('en-US');
  const share=(value,total)=>`${(value/total*100).toFixed(2)}%`;
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const topRows=panel=>page.locator(`${panel} tbody tr`).evaluateAll(rows=>rows.map(row=>[...row.children].map(cell=>cell.innerText)));
  assert.equal(await page.locator('#ytd-value').innerText(),`$${billion(data.ytd_usd)}`);
  assert.equal(await page.locator('#ytd-value').innerText(),'$1,647');
  assert.equal(await page.locator('#mtd-value').innerText(),`$${billion(data.mtd_usd)}`);
  assert.equal(await page.locator('#mtd-value').innerText(),'$158');
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);
  await page.locator('[data-forecast-view=supply]:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-forecast-year]').innerText(),'2026');
  assert.deepEqual(await page.locator('.forecast-table thead th').allTextContents(),['預期項目','BofA','GS']);
  assert.deepEqual(await page.locator('.forecast-table tbody th').allTextContents(),['2026 Gross Supply','9 月 Gross Supply','2026 Hyperscaler Issuance']);
  assert.match(await page.locator('.forecast-table').innerText(),/\$2\.1Tn/);
  assert.match(await page.locator('.forecast-table').innerText(),/\$190Bn/);
  assert.match(await page.locator('.forecast-table').innerText(),/\$330Bn/);
  if(width===375)assert.equal(await page.locator('.forecast-table-wrap').evaluate(node=>node.scrollWidth>node.clientWidth),true);
  await page.locator('#ytd-forecast-comparison:not([hidden])').waitFor();
  assert.equal(await page.locator('#ytd-forecast-comparison').innerText(),'BofA 2026E $2.1Tn · 已達 78%');
  assert.equal(await page.locator('#mtd-forecast-comparison').innerText(),'BofA 9月E $190Bn · 已達 83%');

  const industryName=data.breakdowns.industry[0][0],industryTop=Object.fromEntries(data.top_tickers.ytd.industry)[industryName];
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'industry');
  assert.equal(await page.locator('#ytd-chart .supply-bar').count(),data.breakdowns.industry.length);
  const industryBar=page.locator(`#ytd-chart .supply-bar[data-category="${industryName}"]`);
  await industryBar.click();
  assert.equal(await industryBar.getAttribute('role'),'button');
  assert.equal(await industryBar.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#ytd-top-tickers').isVisible(),true);
  assert.deepEqual(await topRows('#ytd-top-tickers'),industryTop.map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,data.breakdowns.industry[0][1])]));
  await industryBar.click();
  assert.equal(await industryBar.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);

  await page.locator('[name=supply-group][value=rating]').check();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'rating');
  assert.equal(await page.locator('#ytd-chart .supply-bar').count(),data.breakdowns.rating.length);
  const ratingName=data.breakdowns.rating[0][0],ratingBar=page.locator(`#ytd-chart .supply-bar[data-category="${ratingName}"]`);
  await ratingBar.click();
  assert.equal(await page.locator('#ytd-top-tickers').isVisible(),true);
  assert.deepEqual(await topRows('#ytd-top-tickers'),Object.fromEntries(data.top_tickers.ytd.rating)[ratingName].map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,data.breakdowns.rating[0][1])]));

  await page.locator('[name=supply-group][value=peer_group]').check();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'peer_group');
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);
  assert.equal(await page.locator('#ytd-chart .supply-bar[data-category="Others"]').count(),0);
  const otherIg=page.locator('#ytd-chart .supply-bar[data-category="Other IG"]'),otherIgTotal=Object.fromEntries(data.breakdowns.peer_group)['Other IG'];
  assert.equal(await otherIg.getAttribute('role'),'button');
  assert.equal(await otherIg.getAttribute('aria-pressed'),'false');
  const peerName=data.peer_definitions[0].name,peerTotal=Object.fromEntries(data.breakdowns.peer_group)[peerName],peerBar=page.locator(`#ytd-chart .supply-bar[data-category="${peerName}"]`);
  assert.equal(await peerBar.getAttribute('role'),'button');
  await peerBar.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'ticker');
  assert.equal(await page.locator('#ytd-chart .supply-bar').count(),data.peer_tickers[peerName].length);
  assert.equal(await page.locator('#peer-back').isVisible(),true);
  assert.deepEqual(await topRows('#ytd-top-tickers'),data.peer_tickers[peerName].slice(0,5).map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,peerTotal)]));
  await page.locator('#peer-back').click();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'peer_group');
  assert.equal(await page.locator('#peer-back').isHidden(),true);
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);
  await peerBar.click();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'ticker');
  await page.locator('[name=supply-group][value=peer_group]').click();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'peer_group');
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);
  await otherIg.click();
  assert.equal(await page.locator('#ytd-chart').getAttribute('data-mode'),'peer_group');
  assert.equal(await page.locator('#peer-back').isHidden(),true);
  assert.equal(await page.locator('#ytd-top-tickers').isVisible(),true);
  assert.deepEqual(await topRows('#ytd-top-tickers'),Object.fromEntries(data.top_tickers.ytd.peer_group)['Other IG'].map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,otherIgTotal)]));
  await otherIg.click();
  assert.equal(await page.locator('#ytd-top-tickers').isHidden(),true);

  assert.equal(await page.locator('#monthly-chart').getAttribute('data-mode'),'total');
  assert.equal(await page.locator('#monthly-chart .supply-bar').count(),12);
  assert.equal(await page.locator('#monthly-top-tickers').isHidden(),true);
  const activeMonth=data.monthly.total.findIndex(value=>value>0),monthBar=page.locator(`#monthly-chart .supply-bar[data-month="${monthNames[activeMonth]}"]`);
  await monthBar.click();
  assert.equal(await monthBar.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#monthly-top-tickers').isVisible(),true);
  assert.deepEqual(await topRows('#monthly-top-tickers'),data.top_tickers.monthly.total[activeMonth].map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,data.monthly.total[activeMonth])]));
  const emptyMonth=page.locator(`#monthly-chart .supply-bar[data-month="${monthNames[data.monthly.total.findIndex(value=>!value)]}"]`);
  assert.equal(await emptyMonth.getAttribute('role'),null);
  assert.equal(await emptyMonth.getAttribute('tabindex'),null);

  await page.locator('[name=monthly-group][value=peer]').check();
  assert.equal(await page.locator('#monthly-chart').getAttribute('data-mode'),'peer');
  assert.equal(await page.locator('#monthly-top-tickers').isHidden(),true);
  assert.equal(await page.locator('#monthly-legend span').count(),data.peer_definitions.length+1);
  assert.equal(await page.locator('#monthly-chart text.bar-label').count(),12);
  const peerMonths=Object.fromEntries(data.monthly.peer_groups)[peerName],peerMonth=peerMonths.findIndex(value=>value>0);
  const emptySegment=page.locator(`#monthly-chart .supply-bar[data-series="${peerName}"][data-month="${monthNames[peerMonths.findIndex(value=>!value)]}"]`);
  assert.equal(await emptySegment.getAttribute('role'),null);
  assert.equal(await emptySegment.getAttribute('tabindex'),null);
  const segment=page.locator(`#monthly-chart .supply-bar[data-series="${peerName}"][data-month="${monthNames[peerMonth]}"]`);
  await segment.click();
  assert.equal(await page.locator('#monthly-top-tickers').isVisible(),true);
  assert.deepEqual(await topRows('#monthly-top-tickers'),Object.fromEntries(data.top_tickers.monthly.peer_groups)[peerName][peerMonth].map(([ticker,value],index)=>[String(index+1),ticker,billion(value),share(value,peerMonths[peerMonth])]));
  await segment.focus();
  assert.equal(await page.locator('#supply-tooltip').isVisible(),true);
  assert.ok((await page.locator('#supply-tooltip').innerText()).endsWith(share(peerMonths[peerMonth],data.monthly.total[peerMonth])),'peer tooltip must use the month total');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#supply-tooltip').isHidden(),true);
  await segment.click();
  assert.equal(await page.locator('#monthly-top-tickers').isHidden(),true);

  assert.equal(await page.locator('.breakdown-card').count(),3);
  for(let index=0;index<3;index++){
    const card=page.locator('.breakdown-card').nth(index);
    assert.equal(await card.locator('tfoot td').nth(1).innerText(),billion(data.ytd_usd));
    assert.equal(await card.locator('tfoot td').nth(2).innerText(),'100.00%');
    for(const value of await card.locator('tbody td:nth-child(2)').allInnerTexts()) assert.match(value,/^\d{1,3}(,\d{3})*$/,`${value} must render as whole $bn`);
    const displayed=(await card.locator('tbody td:nth-child(3)').allInnerTexts()).reduce((sum,value)=>sum+Number(value.replace('%','')),0);
    assert.equal(displayed.toFixed(2),'100.00');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/supply overflow`);
  assert.deepEqual(errors,[]);
  await context.close();
  return {width,supplyRows:data.row_count};
}

async function runForecastFallbacks(browser,base){
  let context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await routeForecast(page,{missing:true});
  await page.goto(base);await page.waitForSelector('.rv-point');
  assert.equal(await page.locator('[data-forecast-feed]').isHidden(),true,'missing additive dataset must preserve the old UI');
  await context.close();

  context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
  await routeForecast(page,{feedStatus:503});
  await page.goto(base);await page.waitForSelector('.rv-point');
  await page.locator('.forecast-retry').waitFor();
  assert.match(await page.locator('[data-forecast-status]').innerText(),/HTTP 503/);
  assert.ok(await page.locator('.rv-point').count()>0,'forecast failure must not break RV charts');
  await context.close();

  context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
  await routeForecast(page,{missing:true});
  await page.goto(base+'supply.html');await page.waitForFunction(()=>document.querySelector('#supply-status')?.textContent.includes('公開聚合快照'));
  assert.equal(await page.locator('[data-forecast-view=supply]').isHidden(),true);
  assert.equal(await page.locator('#ytd-forecast-comparison').isHidden(),true);
  assert.equal(await page.locator('#mtd-forecast-comparison').isHidden(),true);
  assert.ok(await page.locator('#ytd-chart svg').count()>0,'missing forecast must not break Supply charts');
  await context.close();
}

async function runStaleSupply(browser,base,width=1440){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<650});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const stale=JSON.parse(readFileSync('assets/supply-data.json','utf8'));
  stale.schema_version=1;
  delete stale.top_tickers;
  let hits=0;
  await page.route('**/assets/supply-data.json*',route=>{hits++;return route.fulfill({contentType:'application/json',body:JSON.stringify(stale)});});
  await page.goto(base+'supply.html');
  const status=page.locator('#supply-status');
  await status.locator('.reload-button').waitFor();
  assert.match(await status.innerText(),/版本已更新/);
  assert.equal(await status.getAttribute('role'),'status');
  assert.equal(await page.locator('#ytd-value').innerText(),'—');
  assert.equal(await page.locator('#ytd-chart .supply-bar').count(),0);
  await page.locator('#supply-status .reload-button').click();
  await page.waitForFunction(()=>location.search.includes('refresh='));
  assert.ok(hits>=2,`reload must refetch the snapshot (fetches=${hits})`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/supply stale banner overflow`);
  assert.deepEqual(errors,[]);
  await page.unroute('**/assets/supply-data.json*');
  await page.route('**/assets/supply-data.json*',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto(base+'supply.html');
  await page.waitForFunction(()=>document.querySelector('#supply-status')?.textContent.includes('Supply 資料無法載入'));
  assert.match(await page.locator('#supply-status').innerText(),/HTTP 503/);
  assert.equal(await page.locator('#supply-status .reload-button').count(),0,'real failures must not be masked as a version update');
  await context.close();
  return {width,staleBanner:true};
}

module.exports={run,runBonds,runSupply,runStaleSupply,runForecastFallbacks};

const FILES = {
  Spread:'2Y Percentile RV.xlsx',
  '10Y':'10Y RV.xlsx',
  '30Y':'30Y RV.xlsx',
  '10s30s':'10s30s RV.xlsx',
};

function fixtures(root,variant,date) {
  const output=join(root,variant);
  execFileSync('python3',['tests/make_xlsx_fixtures.py','--out',output,'--variant',variant,'--date',date],{stdio:'pipe'});
  return Object.fromEntries(Object.entries(FILES).map(([metric,name])=>[metric,join(output,name)]));
}

async function openUploader(browser,base,expectedDate,width=1440,currentLuacDate='2026-09-15',currentLuacCount=40,bridge=false,currentSupply=null,currentLuacPeers=null) {
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<650});
  const page=await context.newPage();
  const requests=[],bridgeRequests=[];
  const supplySnapshot=currentSupply||JSON.parse(readFileSync('assets/supply-data.json','utf8'));
  await page.route('**/assets/upload-config.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,luac_enabled:true,supply_enabled:true,api_url:'https://rv-upload-service.example.workers.dev'})}));
  await page.route('**/assets/luac-bonds.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({date:currentLuacDate,records:Array.from({length:currentLuacCount},()=>[]),peer_definitions:currentLuacPeers||[]})}));
  await page.route('**/assets/supply-data.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(supplySnapshot)}));
  await page.route('https://rv-upload-service.example.workers.dev/**',async route=>{
    const request=route.request();
    requests.push({url:request.url(),method:request.method(),body:request.postData()});
    if(request.url().endsWith('/session')) return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'test-session',expires_in:900})});
    if(request.url().endsWith('/publish/supply')) return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'44',state:'pending'})});
    if(request.url().endsWith('/publish/luac')) return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'43',state:'pending'})});
    if(request.url().endsWith('/publish')) return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'42',state:'pending'})});
    if(request.url().endsWith('/status/supply/44')) return route.fulfill({contentType:'application/json',body:JSON.stringify({state:'deployed',message:`發布完成：${expectedDate}，正式站驗證 PASS。`})});
    if(request.url().endsWith('/status/luac/43')) return route.fulfill({contentType:'application/json',body:JSON.stringify({state:'deployed',message:`發布完成：${expectedDate}，正式站驗證 PASS。`})});
    if(request.url().endsWith('/status/42')) return route.fulfill({contentType:'application/json',body:JSON.stringify({state:'deployed',message:`發布完成：${expectedDate}，正式站驗證 PASS。`})});
    if(request.url().endsWith('/health')) return route.fulfill({contentType:'text/plain',body:'RV Upload Service OK'});
    return route.fulfill({status:404,body:'not found'});
  });
  if(bridge)await page.route('http://127.0.0.1:8768/**',route=>{const request=route.request();bridgeRequests.push({url:request.url(),body:request.postData()});if(request.url().endsWith('/health'))return route.fulfill({contentType:'application/json',body:JSON.stringify({ready:true})});return route.fulfill({contentType:'application/json',body:JSON.stringify({connected:true,reference_ok:true,universe_ok:true,count:40,required_field_coverage_pct:100,ids_match:true,industry_match:true,max_oas_diff_bp:.4,max_yield_diff_pct:.009,passed:true,error_class:null})});});
  await page.goto(base+`update.html${bridge?'#bbg-token='+'b'.repeat(64):''}`);
  await page.waitForFunction(()=>document.querySelector('#service-state')?.textContent.includes('已啟用'));
  return {context,page,requests,bridgeRequests};
}

function supplyFixture(root,variant='valid'){
  const output=join(root,`supply-${variant}`);
  execFileSync('python3',['tests/make_supply_fixture.py','--out',output,'--variant',variant],{stdio:'pipe'});
  const workbook=join(output,'supply.xlsx'),peers=join(output,'peers.xlsx');
  const snapshot=variant==='valid'?JSON.parse(execFileSync('python3',['scripts/extract_supply.py',workbook,'--peers',peers],{encoding:'utf8',stdio:['ignore','pipe','pipe']})):null;
  return {workbook,peers,snapshot};
}

async function runValidSupplyUpload(browser,base,width,fixture,usePeer=true){
  const {context,page,requests}=await openUploader(browser,base,fixture.snapshot.date,width,'2026-09-15',40,false,fixture.snapshot);
  await page.locator('#supply-file').setInputFiles(fixture.workbook);
  if(usePeer)await page.locator('#peer-group-file').setInputFiles(fixture.peers);
  await page.locator('#validate-supply').click();
  await page.locator('#supply-validation-status.success').waitFor();
  assert.equal(await page.locator('#supply-summary-date').innerText(),fixture.snapshot.date);
  assert.equal(await page.locator('#supply-summary-count').innerText(),String(fixture.snapshot.row_count));
  assert.equal(await page.locator('#supply-summary-corrections').innerText(),'5');
  assert.equal(await page.locator('#supply-summary-duplicates').innerText(),'1');
  assert.match(await page.locator('#supply-file-name').innerText(),/已從程式狀態釋放/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/supply uploader overflow`);
  await page.locator('#supply-upload-password').fill('company password');
  await page.locator('#publish-supply').click();
  await page.locator('#supply-publish-status.success').waitFor();
  const publish=requests.find(item=>item.url.endsWith('/publish/supply'));
  assert.ok(publish,'sanitized Supply publish request was sent');
  assert.deepEqual(Object.keys(JSON.parse(publish.body)),['data']);
  assert.equal(/\.xlsx|source_file|sha256|\/Users\//i.test(publish.body),false);
  assert.deepEqual(JSON.parse(publish.body).data,fixture.snapshot,'browser and Python Supply extraction must match');
  await context.close();
}

async function runInvalidSupplyUpload(browser,base,fixture,expected,currentSnapshot){
  const {context,page,requests}=await openUploader(browser,base,currentSnapshot.date,1440,'2026-09-15',40,false,currentSnapshot);
  await page.locator('#supply-file').setInputFiles(fixture.workbook);
  await page.locator('#peer-group-file').setInputFiles(fixture.peers);
  await page.locator('#validate-supply').click();
  await page.locator('#supply-validation-status.error').waitFor();
  assert.match(await page.locator('#supply-validation-status').innerText(),expected);
  assert.equal(requests.some(item=>item.url.endsWith('/publish/supply')),false);
  await context.close();
}

async function selectFour(page,files) {
  for(const [metric,path] of Object.entries(files)) await page.locator(`input[data-metric="${metric}"]`).setInputFiles(path);
}

async function runValidUpload(browser,base,width,files,expectedDate) {
  const {context,page,requests}=await openUploader(browser,base,expectedDate,width);
  await selectFour(page,files);
  await page.locator('#validate-files').click();
  await page.locator('#validation-status.success').waitFor();
  assert.equal(await page.locator('#summary-date').innerText(),expectedDate);
  assert.equal(await page.locator('#summary-count').innerText(),'460 / 460');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/uploader overflow`);
  await page.locator('#upload-password').fill('company password');
  await page.locator('#publish-data').click();
  await page.locator('#publish-status.success').waitFor();
  const publish=requests.find(item=>item.url.endsWith('/publish'));
  assert.ok(publish,'sanitized publish request was sent');
  assert.deepEqual(Object.keys(JSON.parse(publish.body)),['data']);
  assert.equal(/\.xlsx|2Y Percentile|10Y RV|30Y RV|10s30s RV|source_file|sha256/i.test(publish.body),false,'request must not contain workbook identity or hash');
  assert.equal(JSON.parse(publish.body).data.date,expectedDate);
  await context.close();
}

async function runInvalidUpload(browser,base,files,expected,currentDate) {
  const {context,page,requests}=await openUploader(browser,base,currentDate);
  await selectFour(page,files);
  await page.locator('#validate-files').click();
  await page.locator('#validation-status.error').waitFor();
  assert.match(await page.locator('#validation-status').innerText(),expected);
  assert.equal(requests.some(item=>item.url.endsWith('/publish')),false);
  await context.close();
}

function luacFixture(root,variant,date,count=40){
  const base=join(root,`luac-${variant}-${count}-${date}`);
  execFileSync('python3',['tests/make_luac_fixture.py','--out',`${base}.xlsx`,'--peers-out',`${base}-peers.xlsx`,'--variant',variant,'--date',date,'--count',String(count)],{stdio:'pipe'});
  return {workbook:`${base}.xlsx`,peers:`${base}-peers.xlsx`};
}

async function runValidLuacUpload(browser,base,width,fixture,expectedDate,currentDate,bql=false){
  const {context,page,requests}=await openUploader(browser,base,expectedDate,width,currentDate);
  await page.locator('#luac-file').setInputFiles(fixture.workbook);
  await page.locator('#peer-group-file').setInputFiles(fixture.peers);
  await page.locator('#validate-luac').click();
  await page.locator('#luac-validation-status.success').waitFor();
  assert.equal(await page.locator('#luac-summary-date').innerText(),expectedDate);
  assert.equal(await page.locator('#luac-summary-count').innerText(),'40');
  assert.equal(await page.locator('#luac-summary-source').innerText(),bql?'BQL 已儲存快取':'純值 Excel');
  if(bql){assert.equal(await page.locator('#publish-luac').isDisabled(),true);await page.locator('#bql-confirm').check();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/luac uploader overflow`);
  await page.locator('#luac-upload-password').fill('company password');
  await page.locator('#publish-luac').click();
  await page.locator('#luac-publish-status.success').waitFor();
  const publish=requests.find(item=>item.url.endsWith('/publish/luac'));
  assert.ok(publish,'sanitized LUAC publish request was sent');
  assert.deepEqual(Object.keys(JSON.parse(publish.body)),['data']);
  assert.equal(/\.xlsx|source_file|sha256|\/Users\//i.test(publish.body),false);
  assert.equal(JSON.parse(publish.body).data.date,expectedDate);
  assert.deepEqual(JSON.parse(publish.body).data.peer_definitions,[{name:'Fixture Banks',tickers:['T0','T1']},{name:'Fixture Tech',tickers:['T2','T3']}]);
  const python=JSON.parse(execFileSync('python3',['scripts/extract_luac.py',fixture.workbook,'--peers',fixture.peers],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.deepEqual(JSON.parse(publish.body).data,python,'browser and Python LUAC extraction must match');
  await context.close();
}

async function runInheritedPeerLuacUpload(browser,base,fixture,expectedDate,currentDate){
  const inherited=[{name:'Published Group',tickers:['T0','T1','T2','T3']}];
  const {context,page,requests}=await openUploader(browser,base,expectedDate,1440,currentDate,40,false,null,inherited);
  await page.locator('#luac-file').setInputFiles(fixture.workbook);
  await page.locator('#validate-luac').click();
  await page.locator('#luac-validation-status.success').waitFor();
  await page.locator('#luac-upload-password').fill('company password');
  await page.locator('#publish-luac').click();
  await page.locator('#luac-publish-status.success').waitFor();
  const publish=requests.find(item=>item.url.endsWith('/publish/luac'));
  assert.ok(publish,'LUAC upload without a peer file must reuse the published mapping');
  assert.deepEqual(JSON.parse(publish.body).data.peer_definitions,inherited);
  await context.close();
}

async function runSameDateLuacCorrection(browser,base,fixture,currentDate){
  const {context,page,requests}=await openUploader(browser,base,currentDate,1440,currentDate);
  await page.locator('#luac-file').setInputFiles(fixture.workbook);await page.locator('#peer-group-file').setInputFiles(fixture.peers);await page.locator('#validate-luac').click();await page.locator('#luac-validation-status.success').waitFor();
  assert.match(await page.locator('#luac-validation-status').innerText(),/同日更正 PR/);
  assert.equal(await page.locator('#publish-luac').isDisabled(),false);
  await page.locator('#luac-upload-password').fill('company password');
  await page.locator('#publish-luac').click();await page.locator('#luac-publish-status.success').waitFor();
  const publish=requests.find(item=>item.url.endsWith('/publish/luac'));
  assert.ok(publish,'same-day LUAC correction was sent');
  assert.equal(JSON.parse(publish.body).data.date,currentDate);
  await context.close();
}

async function runBloombergDiagnostic(browser,base,fixture,currentDate){
  const {context,page,requests,bridgeRequests}=await openUploader(browser,base,currentDate,1440,currentDate,40,true);
  await page.locator('#bloomberg-diagnostic').waitFor({state:'visible'});
  await page.locator('#luac-file').setInputFiles(fixture.workbook);await page.locator('#peer-group-file').setInputFiles(fixture.peers);await page.locator('#validate-luac').click();await page.locator('#luac-validation-status.success').waitFor();await page.locator('#bql-confirm').check();
  await page.locator('#probe-bloomberg').click();await page.locator('#bloomberg-status.success').waitFor();
  const probe=bridgeRequests.find(item=>item.url.endsWith('/probe'));assert.ok(probe);assert.deepEqual(Object.keys(JSON.parse(probe.body)),['data']);assert.equal(/\.xlsx|source_file|sha256|\/Users\//i.test(probe.body),false);
  assert.equal(requests.some(item=>item.url.endsWith('/publish/luac')),false,'diagnostic must not call the Worker publish endpoint');
  await context.close();
}

async function runInvalidLuacUpload(browser,base,fixture,expected,currentDate,currentCount=40){
  const {context,page,requests}=await openUploader(browser,base,'2026-09-16',1440,currentDate,currentCount);
  await page.locator('#luac-file').setInputFiles(fixture.workbook);
  await page.locator('#peer-group-file').setInputFiles(fixture.peers);
  await page.locator('#validate-luac').click();
  await page.locator('#luac-validation-status.error').waitFor();
  assert.match(await page.locator('#luac-validation-status').innerText(),expected);
  assert.equal(requests.some(item=>item.url.endsWith('/publish/luac')),false);
  await context.close();
}

if(require.main===module) (async()=>{
  const {chromium}=require('playwright');
  const channel=process.env.RV_BROWSER_CHANNEL;
  const browser=await chromium.launch({headless:true,...(channel?{channel}:{})});
  const base=process.argv.find(argument=>argument.startsWith('http://')||argument.startsWith('https://'))||'http://127.0.0.1:8766/';
  const temporary=mkdtempSync(join(tmpdir(),'rv-upload-test-'));
  try {
    for(const width of [1440,768,375]) console.log(await run(browser,base,width));
    for(const width of [1440,768,375]) console.log(await runBonds(browser,base,width));
    for(const width of [1440,768,375]) console.log(await runSupply(browser,base,width));
    await runForecastFallbacks(browser,base);
    console.log(await runStaleSupply(browser,base,1440));
    const currentDate=JSON.parse(readFileSync('assets/rv-data.json','utf8')).date;
    const nextDate=new Date(`${currentDate}T00:00:00Z`);nextDate.setUTCDate(nextDate.getUTCDate()+1);
    const expectedDate=nextDate.toISOString().slice(0,10);
    const valid=fixtures(temporary,'valid',expectedDate);
    for(const width of [1440,768,375]) await runValidUpload(browser,base,width,valid,expectedDate);
    await runInvalidUpload(browser,base,fixtures(temporary,'date-mismatch',expectedDate),/日期不一致/,currentDate);
    await runInvalidUpload(browser,base,fixtures(temporary,'outdated',currentDate),/必須晚於正式站/,currentDate);
    await runInvalidUpload(browser,base,fixtures(temporary,'missing',expectedDate),/缺值或不是有效數字/,currentDate);
    await runInvalidUpload(browser,base,fixtures(temporary,'order',expectedDate),/Min ≤ Median ≤ Max/,currentDate);
    const wrong={...valid};
    wrong.Spread=join(temporary,'wrong.txt');
    writeFileSync(wrong.Spread,'not an xlsx');
    await runInvalidUpload(browser,base,wrong,/必須選取 .xlsx/,currentDate);
    const currentLuacDate=JSON.parse(readFileSync('assets/luac-bonds.json','utf8')).date;
    const nextLuacDate=new Date(`${currentLuacDate}T00:00:00Z`);nextLuacDate.setUTCDate(nextLuacDate.getUTCDate()+1);
    const expectedLuacDate=nextLuacDate.toISOString().slice(0,10),luacValid=luacFixture(temporary,'valid',expectedLuacDate);
    for(const width of [1440,768,375])await runValidLuacUpload(browser,base,width,luacValid,expectedLuacDate,currentLuacDate);
    await runValidLuacUpload(browser,base,1440,luacFixture(temporary,'bql',expectedLuacDate),expectedLuacDate,currentLuacDate,true);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'formula',expectedLuacDate),/只允許一個 BQL 公式/,currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'bql-no-cache',expectedLuacDate),/沒有已儲存的快取值/,currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'level3',expectedLuacDate),/欄位不符合必要格式/,currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'nonfinite',expectedLuacDate),/OAS.*無效/,currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'mismatch',expectedLuacDate),/ID 必須完整一致/,currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'mixed-date',expectedLuacDate),/資料日期不一致/,currentLuacDate);
    await runSameDateLuacCorrection(browser,base,luacFixture(temporary,'valid',currentLuacDate),currentLuacDate);
    await runInheritedPeerLuacUpload(browser,base,luacFixture(temporary,'valid',currentLuacDate),currentLuacDate,currentLuacDate);
    await runBloombergDiagnostic(browser,base,luacFixture(temporary,'bql',currentLuacDate),currentLuacDate);
    await runInvalidLuacUpload(browser,base,luacFixture(temporary,'valid',expectedLuacDate,25),/超過 ±20%/,currentLuacDate);
    const supplyValid=supplyFixture(temporary);
    for(const width of [1440,768,375])await runValidSupplyUpload(browser,base,width,supplyValid,width!==375);
    for(const [variant,message] of [['missing-column',/必須且只能有一個工作表/],['no-match',/沒有同 ticker/],['tie',/距離相同/],['bad-amount',/Tranche Size 無效/],['bad-tenor',/Tenor 無效/]]){
      const invalid=supplyFixture(temporary,variant);
      await runInvalidSupplyUpload(browser,base,invalid,message,supplyValid.snapshot);
    }
    console.log('browser tests PASS');
  }
  finally {rmSync(temporary,{recursive:true,force:true});await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
