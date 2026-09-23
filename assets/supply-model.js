(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.SupplyModel=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCHEMA_VERSION=3;
  const TENOR_BUCKETS=['FRN','3yr & In (1.5–3.5yr)','5yr (3.5–6yr)','7yr (6–8yr)','10yr (8–12yr)','20yr (12–22yr)','30yr (22–32yr)','>32yr (>32yr)','Perpetual'];
  const LEGACY_TENOR_BUCKETS=['FRN','≤5Y','>5Y–10Y','>10Y / Perpetual'];
  const RATING_ORDER=['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB+','BB','BB-','B+','B','B-','CCC+','CCC','CCC-','CC','C','D','NR'];
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|');
  const usd=value=>Number.isSafeInteger(value)&&value>=0;
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  function pairs(value,name,allowEmpty=false){
    if(!Array.isArray(value)||(!allowEmpty&&!value.length))throw Error(`Supply ${name} 分類無效`);
    const seen=new Set();let total=0;
    for(const row of value){
      if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||!row[0].trim()||seen.has(row[0])||!usd(row[1]))throw Error(`Supply ${name} 列無效`);
      seen.add(row[0]);total+=row[1];
    }
    return total;
  }
  function topPairs(value,name,denominator){
    if(!Array.isArray(value)||value.length>5)throw Error(`Supply ${name} Top 5 結構無效`);
    const total=pairs(value,name,true);
    if(value.some(row=>row[1]<=0)||total>denominator)throw Error(`Supply ${name} Top 5 無效`);
    const sorted=[...value].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    if(value.some((row,index)=>row[0]!==sorted[index][0]||row[1]!==sorted[index][1]))throw Error(`Supply ${name} Top 5 排序不正確`);
  }
  function reconciledPercentages(records,total){
    if(!Array.isArray(records)||!Number.isSafeInteger(total)||total<=0)throw Error('Supply percentage input 無效');
    const divisor=BigInt(total),floors=[],remainders=[];let sum=0n;
    records.forEach((row,index)=>{if(!Array.isArray(row)||!Number.isSafeInteger(row[1])||row[1]<0)throw Error('Supply percentage amount 無效');const product=BigInt(row[1])*10000n,quotient=product/divisor,remainder=product%divisor;floors.push(Number(quotient));remainders.push([remainder,index]);sum+=BigInt(row[1]);});
    if(sum!==divisor)throw Error('Supply percentages 無法勾稽');
    remainders.sort((a,b)=>a[0]===b[0]?a[1]-b[1]:a[0]>b[0]?-1:1);
    const remaining=10000-floors.reduce((a,b)=>a+b,0);
    for(let index=0;index<remaining;index++)floors[remainders[index][1]]++;
    return floors;
  }
  function validateSnapshot(data){
    const fields=['schema_version','date','year','currency','row_count','ytd_usd','mtd_usd','breakdowns','monthly','peer_definitions','peer_tickers','top_tickers','quality'];
    if(!keys(data,fields)||data.currency!=='USD'||!iso(data.date)||data.year!==Number(data.date.slice(0,4)))throw Error('Supply 公開資料結構不正確');
    if(![2,SCHEMA_VERSION].includes(data.schema_version))throw Error('Supply schema_version 不支援');
    if(!Number.isInteger(data.row_count)||data.row_count<1||!usd(data.ytd_usd)||!data.ytd_usd||!usd(data.mtd_usd)||data.mtd_usd>data.ytd_usd)throw Error('Supply 摘要數值無效');
    if(!keys(data.breakdowns,['industry','rating','tenor','peer_group']))throw Error('Supply breakdown 結構不正確');
    for(const name of ['industry','rating','tenor','peer_group'])if(pairs(data.breakdowns[name],name)!==data.ytd_usd)throw Error(`Supply ${name} 無法勾稽 YTD`);
    const tenorBuckets=data.schema_version===2?LEGACY_TENOR_BUCKETS:TENOR_BUCKETS;
    if(data.breakdowns.tenor.map(row=>row[0]).join('|')!==tenorBuckets.join('|'))throw Error('Supply Tenor 順序不正確');
    const ratingPositions=data.breakdowns.rating.map(row=>{const index=RATING_ORDER.indexOf(row[0]);return index<0?RATING_ORDER.length:index;});
    if(data.breakdowns.rating.some(row=>!RATING_ORDER.includes(row[0]))||ratingPositions.some((value,index)=>index&&value<ratingPositions[index-1]))throw Error('Supply Rating 順序不正確');
    if(!keys(data.monthly,['total','peer_groups'])||!Array.isArray(data.monthly.total)||data.monthly.total.length!==12||!data.monthly.total.every(usd)||data.monthly.total.reduce((a,b)=>a+b,0)!==data.ytd_usd)throw Error('Supply 月度總額無效');
    if(!Array.isArray(data.peer_definitions)||!data.peer_definitions.length)throw Error('Supply Peer Group 定義無效');
    const peerNames=[],tickers=new Set();
    for(const definition of data.peer_definitions){
      if(!keys(definition,['name','tickers'])||typeof definition.name!=='string'||!definition.name||['Others','Other IG'].includes(definition.name)||peerNames.includes(definition.name)||!Array.isArray(definition.tickers)||!definition.tickers.length)throw Error('Supply Peer Group 定義無效');
      for(const ticker of definition.tickers)if(typeof ticker!=='string'||!ticker||tickers.has(ticker))throw Error('Supply Peer ticker 無效');else tickers.add(ticker);
      peerNames.push(definition.name);
    }
    const allPeers=[...peerNames,'Other IG'];
    if(data.breakdowns.peer_group.map(row=>row[0]).join('|')!==allPeers.join('|'))throw Error('Supply Peer Group 順序不正確');
    if(!Array.isArray(data.monthly.peer_groups)||data.monthly.peer_groups.map(row=>row[0]).join('|')!==allPeers.join('|'))throw Error('Supply Peer 月度資料無效');
    const reconciled=Array(12).fill(0);
    for(const row of data.monthly.peer_groups){if(!Array.isArray(row)||row.length!==2||!Array.isArray(row[1])||row[1].length!==12||!row[1].every(usd))throw Error('Supply Peer 月度資料無效');row[1].forEach((value,index)=>reconciled[index]+=value);}
    if(reconciled.some((value,index)=>value!==data.monthly.total[index]))throw Error('Supply Peer 月度資料無法勾稽');
    if(!keys(data.peer_tickers,peerNames))throw Error('Supply Peer ticker 結構不正確');
    const peerTotals=Object.fromEntries(data.breakdowns.peer_group);
    for(const name of peerNames)if(pairs(data.peer_tickers[name],name,true)!==peerTotals[name])throw Error(`Supply ${name} ticker 無法勾稽`);
    const top=data.top_tickers;
    if(!keys(top,['ytd','monthly'])||!keys(top.ytd,['industry','rating','peer_group']))throw Error('Supply Top 5 結構不正確');
    for(const field of ['industry','rating','peer_group']){
      const expected=data.breakdowns[field],rows=top.ytd[field];
      if(!Array.isArray(rows)||rows.map(row=>row?.[0]).join('|')!==expected.map(row=>row[0]).join('|'))throw Error(`Supply ${field} Top 5 分類不正確`);
      const totals=Object.fromEntries(expected);for(const [name,tickers] of rows)topPairs(tickers,`${field} ${name}`,totals[name]);
    }
    for(const name of peerNames){const expected=data.peer_tickers[name].slice(0,5),actual=Object.fromEntries(top.ytd.peer_group)[name];if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`Supply ${name} Top 5 無法勾稽`);}
    if(!keys(top.monthly,['total','peer_groups'])||!Array.isArray(top.monthly.total)||top.monthly.total.length!==12)throw Error('Supply 月度 Top 5 結構不正確');
    top.monthly.total.forEach((rows,month)=>topPairs(rows,`${month+1} 月`,data.monthly.total[month]));
    if(!Array.isArray(top.monthly.peer_groups)||top.monthly.peer_groups.map(row=>row?.[0]).join('|')!==allPeers.join('|'))throw Error('Supply 月度 Peer Top 5 分類不正確');
    const monthlyPeer=Object.fromEntries(data.monthly.peer_groups);for(const [name,months] of top.monthly.peer_groups){if(!Array.isArray(months)||months.length!==12)throw Error(`Supply ${name} 月度 Top 5 結構不正確`);months.forEach((rows,month)=>topPairs(rows,`${month+1} 月 ${name}`,monthlyPeer[name][month]));}
    if(!keys(data.quality,['date_corrections','duplicate_cusip_groups'])||!Object.values(data.quality).every(value=>Number.isInteger(value)&&value>=0))throw Error('Supply 品質統計無效');
    return data;
  }
  return {SCHEMA_VERSION,TENOR_BUCKETS,RATING_ORDER,reconciledPercentages,validateSnapshot};
});
