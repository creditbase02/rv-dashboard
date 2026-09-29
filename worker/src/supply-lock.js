// Private Supply reconciliation. Never return records or identity hashes to public assets.
export const TENOR_BUCKETS=['FRN','3yr & In (1.5–3.5yr)','5yr (3.5–6yr)','7yr (6–8yr)','10yr (8–12yr)','20yr (12–22yr)','30yr (22–32yr)','>32yr (>32yr)','Perpetual'];
export const RATING_ORDER=['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB+','BB','BB-','B+','B','B-','CCC+','CCC','CCC-','CC','C','D','NR'];
const supplyPairs=(totals,order=null)=>(order||[...totals.keys()].sort((a,b)=>totals.get(b)-totals.get(a)||(a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0))).map(name=>[name,totals.get(name)||0]);
const supplyTop=totals=>supplyPairs(totals).slice(0,5);
export function aggregate(records,definitions,asOf){
    const peerNames=definitions.map(item=>item.name),allPeers=[...peerNames,'Other IG'],peerLookup=new Map(definitions.flatMap(item=>item.tickers.map(ticker=>[ticker,item.name]))),industry=new Map(),rating=new Map(),tenor=new Map(),peer=new Map(),peerTickers=Object.fromEntries(peerNames.map(name=>[name,new Map()])),industryTickers=new Map(),ratingTickers=new Map(),peerTopTickers=new Map(),monthlyTotal=Array(12).fill(0),monthlyPeer=Object.fromEntries(allPeers.map(name=>[name,Array(12).fill(0)])),monthlyTotalTickers=Array.from({length:12},()=>new Map()),monthlyPeerTickers=Object.fromEntries(allPeers.map(name=>[name,Array.from({length:12},()=>new Map())])),add=(map,key,value)=>map.set(key,(map.get(key)||0)+value),addNested=(outer,key,ticker,value)=>{if(!outer.has(key))outer.set(key,new Map());add(outer.get(key),ticker,value);};
    for(const record of records){const group=record.peer||peerLookup.get(record.ticker)||'Other IG',bucket=record.tenor,month=Number(record.date.slice(5,7))-1;add(industry,record.industry,record.usd);add(rating,record.rating,record.usd);add(tenor,bucket,record.usd);add(peer,group,record.usd);monthlyTotal[month]+=record.usd;monthlyPeer[group][month]+=record.usd;addNested(industryTickers,record.industry,record.ticker,record.usd);addNested(ratingTickers,record.rating,record.ticker,record.usd);addNested(peerTopTickers,group,record.ticker,record.usd);add(monthlyTotalTickers[month],record.ticker,record.usd);add(monthlyPeerTickers[group][month],record.ticker,record.usd);if(group!=='Other IG')add(peerTickers[group],record.ticker,record.usd);}
    const corrections=0;const year=Number(asOf.slice(0,4));const dates=records.map(record=>record.date).sort(),date=asOf||dates.at(-1),ytd=records.reduce((sum,record)=>sum+record.usd,0),month=date.slice(5,7),mtd=records.filter(record=>record.date.slice(5,7)===month).reduce((sum,record)=>sum+record.usd,0),ratingOrder=[...RATING_ORDER.filter(value=>rating.has(value)),...[...rating.keys()].filter(value=>!RATING_ORDER.includes(value)).sort()],cusips=new Map();for(const record of records)cusips.set(record.cusip,(cusips.get(record.cusip)||0)+1);
    const industryPairs=supplyPairs(industry),ratingPairs=supplyPairs(rating,ratingOrder);const data={schema_version:4,date,year,currency:'USD',row_count:records.length,ytd_usd:ytd,mtd_usd:mtd,breakdowns:{industry:industryPairs,rating:ratingPairs,tenor:supplyPairs(tenor,TENOR_BUCKETS),peer_group:supplyPairs(peer,allPeers)},monthly:{total:monthlyTotal,peer_groups:allPeers.map(name=>[name,monthlyPeer[name]])},peer_definitions:definitions,peer_tickers:Object.fromEntries(peerNames.map(name=>[name,supplyPairs(peerTickers[name])])),top_tickers:{ytd:{industry:industryPairs.map(([name])=>[name,supplyTop(industryTickers.get(name)||new Map())]),rating:ratingPairs.map(([name])=>[name,supplyTop(ratingTickers.get(name)||new Map())]),peer_group:allPeers.map(name=>[name,supplyTop(peerTopTickers.get(name)||new Map())])},monthly:{total:monthlyTotalTickers.map(supplyTop),peer_groups:allPeers.map(name=>[name,monthlyPeerTickers[name].map(supplyTop)])}},quality:{date_corrections:corrections,duplicate_cusip_groups:[...cusips.values()].filter(count=>count>1).length}};

return data;
}

const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const dateOK = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const eventKey = r => `${r.id}:${r.date}`;
export function reconcile(baseline, upload, previousTail=[]) {
  if (!baseline || !Array.isArray(baseline.records) || !baseline.records.length || !Array.isArray(baseline.aliases)) throw Error('Supply 私人基準缺失，保留線上版本');
  if (!upload || Object.keys(upload).sort().join()!=='as_of,baseline_version,complete,records' || upload.baseline_version!==baseline.version) throw Error('Supply 基準版本不符，請重新載入');
  if (upload.complete!==true || !dateOK(upload.as_of) || upload.as_of<baseline.through || upload.as_of.slice(0,4)!==baseline.through.slice(0,4)) throw Error('請確認完整未鎖定期間及同年度截止日；跨年須人工建立新基準');
  if (!Array.isArray(upload.records) || upload.records.length>100000) throw Error('Supply 發行記錄無效');
  const byId=new Map(),byCusip=new Map(),bySecurity=new Map();
  for(const r of [...baseline.records,...baseline.aliases])for(const [map,key] of [[byId,r.id],[byCusip,r.cusip],[bySecurity,r.security]]) {if(!map.has(key))map.set(key,[]);map.get(key).push(r);}
  const tail=[],seen=new Set(),securities=new Set();let ignored=0;
  for(const [index,r] of upload.records.entries()) {
    const label=`Supply 第 ${index+1} 筆`;
    if(!r || Object.keys(r).sort().join()!=='cusip,date,id,industry,rating,security,tenor,ticker,usd' || ![r.id,r.cusip,r.security].every(hash))throw Error(`${label} 識別欄位無效`);
    // Identity is checked before amounts/categories/date validation. Historical
    // source fields may be wrong; none of them replaces the reviewed baseline.
    const matches=[...(byId.get(r.id)||[]),...(byCusip.get(r.cusip)||[]),...(bySecurity.get(r.security)||[])];
    if(matches.length && (r.date<=baseline.through || matches.some(m=>m.date===r.date))) {ignored++;continue;}
    if(!dateOK(r.date)||r.date.slice(0,4)!==baseline.through.slice(0,4)||r.date>upload.as_of)throw Error(`${label} 定價日待核對，不自動推定`);
    if(r.date<=baseline.through){ignored++;continue;}
    const approved=(baseline.approved_events||[]).some(a=>Object.keys(r).every(k=>a[k]===r[k]));
    if(matches.length&&!approved)throw Error(`${label} 可能是鎖定券的改期或增額，須先核對發行事件`);
    if(!Number.isSafeInteger(r.usd)||r.usd<=0||r.usd>1e13||!TENOR_BUCKETS.includes(r.tenor)||!RATING_ORDER.includes(r.rating)||!['ticker','industry'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=160))throw Error(`${label} 金額或分類無效`);
    const key=eventKey(r);if(seen.has(key))throw Error(`${label} 發行事件重複，須先核對`);if(securities.has(r.cusip)&&!approved)throw Error(`${label} 同券多次發行須先核對增額`);seen.add(key);securities.add(r.cusip);tail.push({...r});
  }
  if(previousTail.some(r=>!seen.has(eventKey(r))))throw Error('未鎖定期間有已發布交易缺列或改期；請提供完整期間，或走人工核對');
  tail.sort((a,b)=>eventKey(a).localeCompare(eventKey(b)));
  const data=aggregate([...baseline.records,...tail],baseline.peer_definitions,upload.as_of);
  data.quality.date_corrections=baseline.date_corrections||0;
  return {data,tail,ignored};
}
