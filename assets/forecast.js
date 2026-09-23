(()=>{
  'use strict';
  const section=document.querySelector('[data-forecast-feed]');
  if(!section)return;
  const status=section.querySelector('[data-forecast-status]');
  const body=section.querySelector('[data-forecast-body]');
  const tracker=section.querySelector('[data-forecast-tracker]');
  const manifestUrl=section.dataset.forecastManifest;
  const view=section.dataset.forecastView;

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
  function renderSectors(data){
    const rows=window.ForecastModel.sectorRows(data);
    const grid=element('div','forecast-sector-grid');
    rows.forEach(row=>{
      const card=element('article','forecast-broker-card');
      const head=element('header');
      head.append(element('h3','',row.broker),element('time','',row.as_of_date));
      head.querySelector('time').dateTime=row.as_of_date;
      const columns=element('div','forecast-direction-grid');
      for(const [label,items,tone] of [['Overweight',row.overweight,'positive'],['Underweight',row.underweight,'negative']]){
        const group=element('section',`forecast-direction ${tone}`);
        group.append(element('h4','',label),callList(items));columns.append(group);
      }
      card.append(head,columns);grid.append(card);
    });
    body.replaceChildren(grid);
    status.textContent=`資料截至 ${data.content_as_of} · US IG · ${rows.length} 家券商`;
  }
  function renderSupply(data){
    const rows=window.ForecastModel.annualSupplyRows(data);
    const table=element('table','forecast-table');
    const caption=element('caption','sr-only',`${data.reference_year} US IG 券商年度供給預估`);
    const head=document.createElement('thead');
    const headRow=document.createElement('tr');
    ['券商','Annual Gross Supply','Hyperscaler Issuance'].forEach(label=>{const cell=document.createElement('th');cell.scope='col';cell.textContent=label;headRow.append(cell);});
    head.append(headRow);
    const tableBody=document.createElement('tbody');
    rows.forEach(row=>{
      const tr=document.createElement('tr'),broker=document.createElement('th');
      broker.scope='row';broker.textContent=row.broker;tr.append(broker);
      for(const items of [row.gross_supply,row.hyperscaler]){const td=document.createElement('td');td.append(callList(items));tr.append(td);}
      tableBody.append(tr);
    });
    table.append(caption,head,tableBody);
    const wrap=element('div','forecast-table-wrap');wrap.append(table);body.replaceChildren(wrap);
    const heading=section.querySelector('[data-forecast-year]');if(heading)heading.textContent=String(data.reference_year);
    status.textContent=`資料截至 ${data.content_as_of} · US IG · ${rows.length} 家券商`;
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
  load();
})();
