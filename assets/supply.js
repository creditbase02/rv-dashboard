(()=>{
  'use strict';

  const ns='http://www.w3.org/2000/svg';
  const colors=['#176f8f','#3157d5','#8a55a3','#d1842e','#5b8f57','#b64b5a','#657789','#2f9c95','#8b6e45','#855f80','#8a9a3f'];
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const status=document.querySelector('#supply-status');
  const ytdChart=document.querySelector('#ytd-chart');
  const monthlyChart=document.querySelector('#monthly-chart');
  const ytdTop=document.querySelector('#ytd-top-tickers');
  const monthlyTop=document.querySelector('#monthly-top-tickers');
  const tip=document.querySelector('#supply-tooltip');
  const peerBack=document.querySelector('#peer-back');
  let data=null;
  let drilldown=null;
  let ytdSelection=null;
  let monthlySelection=null;

  const svgEl=(name,attrs={},value)=>{
    const element=document.createElementNS(ns,name);
    Object.entries(attrs).forEach(([key,attr])=>element.setAttribute(key,String(attr)));
    if(value!==undefined)element.textContent=value;
    return element;
  };
  const bn=value=>value/1e9;
  const amount=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(bn(value));
  const pct=(value,total)=>`${(total?value/total*100:0).toFixed(2)}%`;
  const topMap=scope=>Object.fromEntries(data.top_tickers.ytd[scope].map(([name,pairs])=>[name,pairs]));

  function hideTip(){tip.hidden=true;}
  function showTip(target,title,value,total,event){
    tip.replaceChildren();
    const strong=document.createElement('strong');
    const span=document.createElement('span');
    strong.textContent=title;
    span.textContent=`$${amount(value)}bn · ${pct(value,total)}`;
    tip.append(strong,span);
    tip.hidden=false;
    const box=target.getBoundingClientRect();
    const x=event?.clientX??box.x+box.width/2;
    const y=event?.clientY??box.y;
    tip.style.left=`${Math.max(8,Math.min(innerWidth-tip.offsetWidth-8,x+10))}px`;
    tip.style.top=`${Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,y-tip.offsetHeight-10))}px`;
  }
  function bindBar(element,label,value,total,onActivate,selected=false,basis='所選分類'){
    element.setAttribute('tabindex','0');
    element.setAttribute('aria-label',`${label}：$${amount(value)}bn，佔${basis} ${pct(value,total)}`);
    element.setAttribute('aria-describedby','supply-tooltip');
    if(selected)element.classList.add('selected');
    element.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showTip(element,label,value,total,event);});
    element.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')showTip(element,label,value,total,event);});
    element.addEventListener('pointerleave',hideTip);
    element.addEventListener('focus',()=>showTip(element,label,value,total));
    element.addEventListener('blur',hideTip);
    if(onActivate){
      element.setAttribute('role','button');
      element.setAttribute('aria-pressed',String(selected));
      const activate=()=>onActivate();
      element.addEventListener('click',activate);
      element.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}
      });
    }
  }
  function renderTopPanel(container,selection){
    if(!selection){container.hidden=true;container.replaceChildren();return;}
    const section=document.createElement('div');
    section.className='top-tickers-inner';
    const header=document.createElement('header');
    const heading=document.createElement('h3');
    const close=document.createElement('button');
    heading.textContent=`${selection.title} · Top 5 Tickers`;
    close.type='button';close.className='top-tickers-close';close.textContent='收起';
    close.setAttribute('aria-label',`收起 ${selection.title} Top 5 Tickers`);
    close.addEventListener('click',selection.close);
    header.append(heading,close);
    const table=document.createElement('table');
    table.innerHTML='<thead><tr><th scope="col">Rank</th><th scope="col">Ticker</th><th scope="col">$bn</th><th scope="col">%</th></tr></thead><tbody></tbody>';
    const body=table.querySelector('tbody');
    selection.pairs.forEach(([ticker,value],index)=>{
      const row=document.createElement('tr');
      row.innerHTML='<td></td><th scope="row"></th><td></td><td></td>';
      row.children[0].textContent=String(index+1);
      row.children[1].textContent=ticker;
      row.children[2].textContent=amount(value);
      row.children[3].textContent=pct(value,selection.total);
      body.append(row);
    });
    if(!selection.pairs.length){
      const row=document.createElement('tr');
      const cell=document.createElement('td');cell.colSpan=4;cell.textContent='此分類沒有發行資料。';
      row.append(cell);body.append(row);
    }
    section.append(header,table);
    container.replaceChildren(section);container.hidden=false;
  }
  function toggleYtdSelection(scope,name,total,pairs){
    const key=`${scope}:${name}`;
    if(ytdSelection?.key===key){ytdSelection=null;if(scope==='peer_group')drilldown=null;}
    else{
      ytdSelection={key,title:name,total,pairs,close:()=>{ytdSelection=null;if(scope==='peer_group')drilldown=null;renderYtd();}};
      if(scope==='peer_group')drilldown=data.peer_definitions.some(item=>item.name===name)?name:null;
    }
    renderYtd();
  }
  function returnPeer(){drilldown=null;ytdSelection=null;renderYtd();}

  function verticalBars(records,label,scope,clickable=true){
    const width=Math.max(720,records.length*86+92),height=410,left=58,right=18,top=30,bottom=96;
    const plotHeight=height-top-bottom,max=Math.max(...records.map(row=>row[1]),1),nice=Math.ceil(max/1e11)*1e11||1e11;
    const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':label});svg.style.minWidth=`${width}px`;
    for(let step=0;step<=4;step++){
      const value=nice*step/4,y=top+plotHeight*(1-step/4);
      svg.append(svgEl('line',{x1:left,y1:y,x2:width-right,y2:y,stroke:'#e1e8ed'}),svgEl('text',{x:left-8,y:y+4,'text-anchor':'end'},amount(value)));
    }
    svg.append(svgEl('text',{x:left,y:15,class:'axis-title'},'Issuance volume ($bn)'));
    const step=(width-left-right)/records.length,barWidth=Math.min(50,step*.62);
    const tops=scope?topMap(scope):{};
    records.forEach(([name,value],index)=>{
      const x=left+step*index+(step-barWidth)/2,h=value/nice*plotHeight,y=top+plotHeight-h;
      const bar=svgEl('rect',{x,y,width:barWidth,height:h,rx:3,fill:colors[index%colors.length],class:'supply-bar','data-category':name,'data-value':value});
      const key=scope?`${scope}:${name}`:'';
      bindBar(bar,name,value,data.ytd_usd,clickable&&scope?()=>toggleYtdSelection(scope,name,value,tops[name]||[]):null,ytdSelection?.key===key,'YTD 總量');
      svg.append(bar,svgEl('text',{x:x+barWidth/2,y:y-7,'text-anchor':'middle',class:'bar-value'},amount(value)));
      const text=svgEl('text',{x:x+barWidth/2,y:top+plotHeight+18,'text-anchor':'middle',class:'bar-label'}),words=name.split(/\s+/);
      if(name.length>12&&words.length>1){const midpoint=Math.ceil(words.length/2);text.append(svgEl('tspan',{x:x+barWidth/2},words.slice(0,midpoint).join(' ')),svgEl('tspan',{x:x+barWidth/2,dy:14},words.slice(midpoint).join(' ')));}
      else text.textContent=name;
      svg.append(text);
    });
    return svg;
  }
  function renderYtd(){
    hideTip();
    const group=document.querySelector('[name=supply-group]:checked').value;
    let records=data.breakdowns[group],title=`${data.year} YTD Issuance`,subtitle={industry:'Ind Sector',rating:'BB Composite',peer_group:'Peer Group'}[group],scope=group,clickable=true;
    if(group==='peer_group'&&drilldown){
      records=data.peer_tickers[drilldown];title=`${data.year} YTD Issuance — ${drilldown}`;subtitle='Ticker';scope=null;clickable=false;peerBack.hidden=false;
    }else{drilldown=null;peerBack.hidden=true;}
    document.querySelector('#ytd-chart-title').textContent=title;
    document.querySelector('#ytd-chart-subtitle').textContent=subtitle;
    ytdChart.replaceChildren(verticalBars(records,`${title} by ${subtitle}`,scope,clickable));
    ytdChart.dataset.mode=drilldown?'ticker':group;
    renderTopPanel(ytdTop,ytdSelection);
  }

  function toggleMonthlySelection(key,title,total,pairs){
    monthlySelection=monthlySelection?.key===key?null:{key,title,total,pairs,close:()=>{monthlySelection=null;renderMonthly();}};
    renderMonthly();
  }
  function renderMonthly(){
    hideTip();
    const mode=document.querySelector('[name=monthly-group]:checked').value;
    const width=900,height=410,left=58,right=18,top=30,bottom=70,plotHeight=height-top-bottom;
    const series=mode==='total'?[['All IG',data.monthly.total]]:data.monthly.peer_groups;
    const max=Math.max(...months.map((_,month)=>series.reduce((sum,row)=>sum+row[1][month],0)),1),nice=Math.ceil(max/2e10)*2e10||2e10;
    const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':'Monthly issuance volume'});svg.style.minWidth=`${width}px`;
    const monthlyPeer=Object.fromEntries(data.top_tickers.monthly.peer_groups);
    for(let step=0;step<=4;step++){
      const value=nice*step/4,y=top+plotHeight*(1-step/4);
      svg.append(svgEl('line',{x1:left,y1:y,x2:width-right,y2:y,stroke:'#e1e8ed'}),svgEl('text',{x:left-8,y:y+4,'text-anchor':'end'},amount(value)));
    }
    svg.append(svgEl('text',{x:left,y:15,class:'axis-title'},'Issuance volume ($bn)'));
    const step=(width-left-right)/12,barWidth=48;
    months.forEach((month,index)=>{
      let accumulated=0;
      series.forEach((row,seriesIndex)=>{
        const value=row[1][index],h=value/nice*plotHeight,x=left+step*index+(step-barWidth)/2,y=top+plotHeight-(accumulated+value)/nice*plotHeight;
        const key=mode==='total'?`total:${index}`:`peer:${row[0]}:${index}`;
        const segment=value,monthTotal=data.monthly.total[index];
        const pairs=mode==='total'?data.top_tickers.monthly.total[index]:monthlyPeer[row[0]][index];
        const title=mode==='total'?`${month} · All IG`:`${month} · ${row[0]}`;
        const bar=svgEl('rect',{x,y,width:barWidth,height:h,fill:colors[seriesIndex%colors.length],class:'supply-bar','data-month':month,'data-series':row[0],'data-value':value});
        if(value)bindBar(bar,title,segment,monthTotal,()=>toggleMonthlySelection(key,title,segment,pairs),monthlySelection?.key===key,'當月總量');
        svg.append(bar);accumulated+=value;
      });
      svg.append(svgEl('text',{x:left+step*index+step/2,y:top+plotHeight+21,'text-anchor':'middle',class:'bar-label'},month));
    });
    monthlyChart.replaceChildren(svg);monthlyChart.dataset.mode=mode;
    const legend=document.querySelector('#monthly-legend');
    legend.replaceChildren(...series.map((row,index)=>{const item=document.createElement('span'),key=document.createElement('i');key.style.background=colors[index%colors.length];item.append(key,document.createTextNode(row[0]));return item;}));
    renderTopPanel(monthlyTop,monthlySelection);
  }
  function renderTables(){
    const labels={industry:'Industry Breakdown',rating:'BB Composite Breakdown',tenor:'Tenor Breakdown'},container=document.querySelector('#breakdown-tables');
    container.replaceChildren(...['industry','rating','tenor'].map(field=>{
      const section=document.createElement('section');section.className='breakdown-card';
      const heading=document.createElement('h3');heading.textContent=labels[field];
      const table=document.createElement('table');table.innerHTML='<thead><tr><th scope="col">Category</th><th scope="col">$bn</th><th scope="col">%</th></tr></thead><tbody></tbody><tfoot><tr><td>Total</td><td></td><td>100.00%</td></tr></tfoot>';
      const body=table.querySelector('tbody'),records=data.breakdowns[field],percentages=window.SupplyModel.reconciledPercentages(records,data.ytd_usd);
      records.forEach(([name,value],index)=>{const row=document.createElement('tr');row.innerHTML='<th scope="row"></th><td></td><td></td>';row.children[0].textContent=name;row.children[1].textContent=amount(value);row.children[2].textContent=`${(percentages[index]/100).toFixed(2)}%`;body.append(row);});
      table.querySelector('tfoot td:nth-child(2)').textContent=amount(data.ytd_usd);section.append(heading,table);return section;
    }));
  }
  function render(){
    document.querySelector('#ytd-label').textContent=`${data.year} YTD Issuance`;
    document.querySelector('#mtd-label').textContent=`${data.year} MTD Issuance`;
    document.querySelector('#ytd-value').textContent=`$${amount(data.ytd_usd)}`;
    document.querySelector('#mtd-value').textContent=`$${amount(data.mtd_usd)}`;
    document.querySelector('#row-count').textContent=new Intl.NumberFormat('en-US').format(data.row_count);
    document.querySelector('#quality-summary').textContent=`${data.quality.date_corrections} 筆日期校正 · ${data.quality.duplicate_cusip_groups} 組重複 CUSIP`;
    const supplySummary=Object.freeze({date:data.date,ytd_usd:data.ytd_usd,mtd_usd:data.mtd_usd});
    window.RVSupplySummary=supplySummary;
    document.dispatchEvent(new CustomEvent('rv:supply-ready',{detail:supplySummary}));
    status.textContent=`${data.date} · ${data.row_count.toLocaleString('en-US')} 筆發行記錄 · 公開聚合快照`;
    renderYtd();renderMonthly();renderTables();
  }

  document.querySelectorAll('[name=supply-group]').forEach(input=>{
    input.addEventListener('click',()=>{if(input.value==='peer_group'&&input.checked&&drilldown)returnPeer();});
    input.addEventListener('change',()=>{drilldown=null;ytdSelection=null;renderYtd();});
  });
  document.querySelectorAll('[name=monthly-group]').forEach(input=>input.addEventListener('change',()=>{monthlySelection=null;renderMonthly();}));
  peerBack.addEventListener('click',returnPeer);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTip();});
  document.addEventListener('click',event=>{if(!event.target.closest('.supply-bar'))hideTip();});
  window.addEventListener('scroll',hideTip,true);
  const version=document.querySelector('.supply-date time')?.getAttribute('datetime')||String(Date.now());
  function reportLoadFailure(error){
    status.replaceChildren();
    status.classList.add('error');
    if(!error.staleVersion){status.textContent=`Supply 資料無法載入：${error.message}`;return;}
    status.append(document.createTextNode('偵測到資料版本已更新，請重新載入頁面取得最新內容。'));
    const reload=document.createElement('button');
    reload.type='button';reload.className='supply-button reload-button';reload.textContent='重新載入';
    reload.addEventListener('click',()=>{const next=new URL(location.href);next.searchParams.set('refresh',String(Date.now()));location.replace(next.toString());});
    status.append(' ',reload);
  }
  fetch(`assets/supply-data.json?v=${encodeURIComponent(version)}`,{cache:'no-store'})
    .then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();})
    .then(snapshot=>{
      if(!window.SupplyModel)throw Object.assign(Error('Supply 資料模型未載入'),{staleVersion:true});
      try{return window.SupplyModel.validateSnapshot(snapshot);}catch(error){error.staleVersion=true;throw error;}
    })
    .then(snapshot=>{data=snapshot;render();})
    .catch(reportLoadFailure);
})();
