(()=>{
  'use strict';
  const section=document.querySelector('[data-forecast-feed]');
  if(!section)return;
  const status=section.querySelector('[data-forecast-status]');
  const body=section.querySelector('[data-forecast-body]');
  const tracker=section.querySelector('[data-forecast-tracker]');
  const manifestUrl=section.dataset.forecastManifest;
  const view=section.dataset.forecastView;
  let supplySummary=window.RVSupplySummary||null;
  let forecastData=null;

  function element(name,className,text){
    const node=document.createElement(name);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function callLink(item){
    const link=element('a','forecast-call');
    link.href=item.source_url;
    link.title=item.note||`${item.broker} ${item.type}`;
    link.append(element('span','forecast-call-value',item.call));
    const meta=element('span','forecast-call-meta',`${item.call_date} · ${item.status==='Carried'?'延續':'最新'}`);
    link.append(meta);
    return link;
  }
  function callList(items){
    if(!items.length)return element('span','forecast-empty','—');
    const list=element('div','forecast-call-list');
    items.forEach(item=>list.append(callLink(item)));
    return list;
  }
  function sectorCallDetail(call){
    const item=element('div','forecast-sector-call');
    const heading=element('strong','',call.call);
    const meta=element('span','forecast-sector-meta',`${call.call_date} · ${call.status==='Carried'?'延續':'最新'}`);
    const note=element('p','',call.note||'無補充說明');
    const link=element('a','','查看報告 →');link.href=call.source_url;
    item.append(heading,meta,note,link);return item;
  }
  function brokerDisclosure(entry){
    const disclosure=element('details','forecast-broker-disclosure');
    const summary=element('summary','forecast-broker-tag',`${entry.broker}${entry.detailed?'＊':''}`);
    const detail=element('div','forecast-broker-detail');
    entry.calls.forEach(call=>detail.append(sectorCallDetail(call)));
    disclosure.append(summary,detail);return disclosure;
  }
  function sectorBrokerCell(entries){
    if(!entries.length)return element('span','forecast-empty','—');
    const cell=element('div','forecast-sector-brokers');
    entries.forEach(entry=>cell.append(brokerDisclosure(entry)));
    return cell;
  }
  function renderSectors(data){
    const matrix=window.ForecastModel.sectorMatrix(data);
    const container=element('div','forecast-sector-tables');
    matrix.groups.forEach(group=>{
      const panel=element('section','forecast-sector-panel');
      panel.append(element('h3','',group.name));
      const wrap=element('div','forecast-sector-table-wrap'),table=element('table','forecast-sector-table');
      const caption=element('caption','sr-only',`${group.name} 產業券商 OW／UW 對照`);
      const head=document.createElement('thead'),headRow=document.createElement('tr');
      ['產業','OW','UW'].forEach(label=>{const th=document.createElement('th');th.scope='col';th.textContent=label;headRow.append(th);});head.append(headRow);
      const tableBody=document.createElement('tbody');
      group.rows.forEach(row=>{
        const tr=document.createElement('tr'),sector=document.createElement('th');tr.dataset.sector=row.sector;tr.tabIndex=-1;sector.scope='row';sector.textContent=row.sector;tr.append(sector);
        for(const entries of [row.overweight,row.underweight]){const td=document.createElement('td');td.append(sectorBrokerCell(entries));tr.append(td);}
        tableBody.append(tr);
      });
      table.append(caption,head,tableBody);wrap.append(table);panel.append(wrap);container.append(panel);
    });
    const hasDetailed=matrix.groups.some(group=>group.rows.some(row=>[...row.overweight,...row.underweight].some(entry=>entry.detailed)));
    if(hasDetailed)container.append(element('p','forecast-sector-footnote','＊代表細項觀點；點選券商可查看原始分類與來源。'));
    if(matrix.unmapped.length){
      const unmapped=element('details','forecast-unmapped'),summary=element('summary','',`未對應觀點（${matrix.unmapped.length}）`),list=element('div','forecast-unmapped-list');
      matrix.unmapped.forEach(call=>{
        const item=element('article','forecast-unmapped-item');
        const heading=element('strong','',`${call.broker} · ${call.type==='Overweight Sector'?'OW':'UW'} · ${call.call}`);
        item.append(heading,sectorCallDetail(call));list.append(item);
      });
      unmapped.append(summary,list);container.append(unmapped);
    }
    body.replaceChildren(container);
    const brokers=new Set(data.calls.filter(call=>call.asset==='US IG'&&['Overweight Sector','Underweight Sector'].includes(call.type)).map(call=>call.broker));
    status.textContent=`資料截至 ${data.content_as_of} · US IG · ${brokers.size} 家券商 · ${matrix.mapped_calls}/${matrix.total_calls} 筆已對應`;
    document.dispatchEvent(new CustomEvent('forecast:sectors-ready',{detail:matrix}));
  }
  function renderSupply(data){
    const supplyDate=document.querySelector('.supply-date time')?.dateTime||data.content_as_of;
    const matrix=window.ForecastModel.supplyMatrix(data,supplyDate.slice(0,7));
    const table=element('table','forecast-table');
    const caption=element('caption','sr-only',`${matrix.year} US IG 券商供給預估`);
    const head=document.createElement('thead');
    const headRow=document.createElement('tr');
    ['預期項目',...matrix.brokers].forEach(label=>{const cell=document.createElement('th');cell.scope='col';cell.textContent=label;headRow.append(cell);});
    head.append(headRow);
    const tableBody=document.createElement('tbody');
    matrix.rows.forEach(row=>{
      const tr=document.createElement('tr'),label=document.createElement('th');
      label.scope='row';label.textContent=row.label;tr.append(label);
      row.calls.forEach(call=>{const td=document.createElement('td');td.append(call?callLink(call):element('span','forecast-empty','—'));tr.append(td);});
      tableBody.append(tr);
    });
    table.append(caption,head,tableBody);
    const wrap=element('div','forecast-table-wrap');wrap.append(table);body.replaceChildren(wrap);
    const heading=section.querySelector('[data-forecast-year]');if(heading)heading.textContent=matrix.year;
    status.textContent=`資料截至 ${data.content_as_of} · US IG · ${matrix.brokers.length} 家券商`;
    forecastData=data;
    renderSupplyComparisons();
  }
  function renderSupplyComparisons(){
    if(view!=='supply'||!forecastData||!supplySummary)return;
    const month=supplySummary.date.slice(0,7);
    const matrix=window.ForecastModel.supplyMatrix(forecastData,month);
    const brokerIndex=matrix.brokers.indexOf('BofA');
    const targets=[
      ['annual','#ytd-forecast-comparison',supplySummary.ytd_usd,`${matrix.year}E`],
      ['monthly','#mtd-forecast-comparison',supplySummary.mtd_usd,`${Number(month.slice(5))}月E`],
    ];
    targets.forEach(([key,selector,actual,label])=>{
      const node=document.querySelector(selector),row=matrix.rows.find(item=>item.key===key),call=brokerIndex<0?null:row?.calls[brokerIndex];
      const progress=window.ForecastModel.progressPercent(actual,call);
      if(!node||!call||progress===null){if(node)node.hidden=true;return;}
      node.textContent=`BofA ${label} ${call.call} · 已達 ${progress}%`;
      node.hidden=false;
    });
  }
  function showError(error){
    section.hidden=false;section.classList.add('forecast-error');body.replaceChildren();status.replaceChildren();
    status.append(document.createTextNode(`券商 forecast 暫時無法載入：${error.message} `));
    const retry=element('button','forecast-retry','重試');retry.type='button';retry.addEventListener('click',load);status.append(retry);
  }
  async function json(url){
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function load(){
    section.classList.remove('forecast-error');status.textContent='正在載入券商 forecast…';body.replaceChildren();
    try{
      if(!window.ForecastModel)throw Error('Forecast model 未載入');
      const manifest=await json(`${manifestUrl}${manifestUrl.includes('?')?'&':'?'}t=${Date.now()}`);
      const dataset=window.ForecastModel.validateManifest(manifest);
      if(!dataset){section.hidden=true;return;}
      section.hidden=false;
      const data=window.ForecastModel.validateFeed(await json(`${dataset.url}?v=${encodeURIComponent(dataset.version)}`),dataset.origin);
      if(data.content_as_of!==dataset.content_as_of)throw Error('Forecast manifest 與 feed 日期不一致');
      tracker.href=data.source_url;
      if(view==='sectors')renderSectors(data);else if(view==='supply')renderSupply(data);else throw Error('Forecast view 無效');
    }catch(error){showError(error);}
  }
  document.addEventListener('rv:supply-ready',event=>{supplySummary=event.detail;renderSupplyComparisons();});
  load();
})();
