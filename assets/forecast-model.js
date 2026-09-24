(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.ForecastModel=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCHEMA_VERSION=1;
  const ASSETS=['US IG','US HY','EUR IG','EUR HY'];
  const TYPES=['Spread','Gross Supply','Overweight Sector','Underweight Sector','Hyperscaler Issuance'];
  const STATUSES=['Latest','Carried'];
  const SECTOR_GROUPS=[
    {name:'Cyclical',sectors:['US Bank','Yankee Bank','Insurance','M&M','Chemical','Tech','Auto','Media','Energy','Capital Good']},
    {name:'Non-Cyclical',sectors:['Telecom','Utility','F&B','Tobacco','Healthcare','Retail','Transportation']},
  ];
  const SECTOR_RULES=[
    ['US Bank',['US Banks'],['Large US Banks - Sen HoldCos']],
    ['Yankee Bank',['Yankee Banks'],['Japanese Banks','Australian/NZ Banks','Canadian Banks']],
    ['Insurance',['Insurance'],['Life Insurance']],
    ['M&M',['Metals/Mining'],[]],
    ['Chemical',['Chemicals'],[]],
    ['Tech',[],['Semiconductors']],
    ['Auto',['Autos','Automotive'],['Automotive Suppliers','Automotive Manufacturing']],
    ['Media',[],['Media Entertainment','Diversified Media','Cable/Satellite']],
    ['Energy',['Energy'],['Pipelines','Energy Services']],
    ['Capital Good',[],['Aerospace/Defense']],
    ['Telecom',[],['Yankee Telecoms']],
    ['Utility',['Utilities'],[]],
    ['F&B',['Food & Bev','Food/Beverages'],[]],
    ['Tobacco',['Tobacco'],[]],
    ['Healthcare',['Health Care'],['Large Cap Pharma','Healthcare Services','Healthcare Pharmaceuticals']],
    ['Retail',['Retail'],['Non-Food Retail','Food/Drug Retail']],
    ['Transportation',[],[]],
  ];
  const BROKER_SECTOR_RULES={};
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|');
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  const text=(value,max=2000)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
  const httpsUrl=value=>{try{return typeof value==='string'&&new URL(value).protocol==='https:';}catch{return false;}};
  const normalizeSector=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US'):'';

  function validateManifest(manifest){
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.site_id!=='ib-knowledge-base'||manifest.validation_status!=='PASS')throw Error('IB integration manifest 無效');
    const forecast=manifest.datasets?.forecast;
    if(forecast===undefined)return null;
    if(!keys(forecast,['asset','schema_version','content_as_of','sha256'])||forecast.schema_version!==SCHEMA_VERSION||!iso(forecast.content_as_of)||!httpsUrl(manifest.production_url))throw Error('Forecast dataset manifest 無效');
    if(typeof forecast.asset!=='string'||!forecast.asset.endsWith('.json')||forecast.asset.startsWith('/')||forecast.asset.includes('..')||!/^[-a-zA-Z0-9_./]+$/.test(forecast.asset)||!/^[a-f0-9]{64}$/.test(forecast.sha256))throw Error('Forecast dataset asset 無效');
    const production=new URL(manifest.production_url),asset=new URL(forecast.asset,production);
    if(asset.origin!==production.origin)throw Error('Forecast dataset origin 無效');
    return {url:asset.toString(),version:forecast.sha256,content_as_of:forecast.content_as_of,origin:production.origin};
  }

  function validateFeed(data,expectedOrigin){
    if(!keys(data,['schema_version','site_id','content_as_of','reference_year','source_url','calls'])||data.schema_version!==SCHEMA_VERSION||data.site_id!=='ib-knowledge-base'||!iso(data.content_as_of)||data.reference_year!==Number(data.content_as_of.slice(0,4))||!httpsUrl(data.source_url)||!Array.isArray(data.calls))throw Error('Forecast feed 結構不正確');
    const sourceOrigin=new URL(data.source_url).origin;
    if(expectedOrigin&&sourceOrigin!==expectedOrigin)throw Error('Forecast feed origin 不正確');
    for(const call of data.calls){
      if(!keys(call,['broker','asset','type','call','target_date','call_date','as_of_date','status','note','source_url']))throw Error('Forecast call 欄位不正確');
      if(!text(call.broker,80)||!call.broker||!ASSETS.includes(call.asset)||!TYPES.includes(call.type)||!text(call.call,500)||!call.call||!text(call.target_date,80)||!iso(call.call_date)||!iso(call.as_of_date)||call.call_date>call.as_of_date||call.as_of_date>data.content_as_of||!STATUSES.includes(call.status)||!text(call.note)||!httpsUrl(call.source_url))throw Error('Forecast call 內容無效');
      const url=new URL(call.source_url);
      if(url.origin!==sourceOrigin||!url.pathname.includes('/reports/'))throw Error('Forecast call source_url 無效');
    }
    return data;
  }

  function groupCalls(data,types){
    const groups=new Map();
    data.calls.filter(call=>call.asset==='US IG'&&types.includes(call.type)).forEach(call=>{
      if(!groups.has(call.broker))groups.set(call.broker,{broker:call.broker,as_of_date:call.as_of_date,overweight:[],underweight:[],gross_supply:[],hyperscaler:[]});
      const row=groups.get(call.broker);
      if(call.as_of_date>row.as_of_date)row.as_of_date=call.as_of_date;
      if(call.type==='Overweight Sector')row.overweight.push(call);
      if(call.type==='Underweight Sector')row.underweight.push(call);
      if(call.type==='Gross Supply')row.gross_supply.push(call);
      if(call.type==='Hyperscaler Issuance')row.hyperscaler.push(call);
    });
    const sortCalls=items=>items.sort((a,b)=>b.call_date.localeCompare(a.call_date)||a.call.localeCompare(b.call));
    return [...groups.values()].sort((a,b)=>a.broker.localeCompare(b.broker)).map(row=>({...row,overweight:sortCalls(row.overweight),underweight:sortCalls(row.underweight),gross_supply:sortCalls(row.gross_supply),hyperscaler:sortCalls(row.hyperscaler)}));
  }

  function sectorRows(data){return groupCalls(data,['Overweight Sector','Underweight Sector']);}
  function sectorRuleIndex(){
    const index=new Map();
    for(const group of SECTOR_GROUPS)for(const sector of group.sectors)index.set(normalizeSector(sector),{sector,detailed:false});
    for(const [sector,broad,detailed] of SECTOR_RULES){
      broad.forEach(alias=>index.set(normalizeSector(alias),{sector,detailed:false}));
      detailed.forEach(alias=>index.set(normalizeSector(alias),{sector,detailed:true}));
    }
    return index;
  }
  function resolveSector(call,brokerRules=BROKER_SECTOR_RULES){
    const sectorKey=normalizeSector(call.call),brokerKey=normalizeSector(call.broker);
    const override=brokerRules?.[brokerKey]?.[sectorKey];
    if(override)return typeof override==='string'?{sector:override,detailed:false}:{sector:override.sector,detailed:Boolean(override.detailed)};
    return sectorRuleIndex().get(sectorKey)||null;
  }
  function sectorMatrix(data,brokerRules=BROKER_SECTOR_RULES){
    const calls=data.calls.filter(call=>call.asset==='US IG'&&['Overweight Sector','Underweight Sector'].includes(call.type));
    const buckets=new Map(),unmapped=[];
    for(const group of SECTOR_GROUPS)for(const sector of group.sectors)for(const direction of ['overweight','underweight'])buckets.set(`${sector}|${direction}`,new Map());
    for(const call of calls){
      const match=resolveSector(call,brokerRules);
      if(!match){unmapped.push(call);continue;}
      const direction=call.type==='Overweight Sector'?'overweight':'underweight';
      const brokerBucket=buckets.get(`${match.sector}|${direction}`);
      if(!brokerBucket){unmapped.push(call);continue;}
      if(!brokerBucket.has(call.broker))brokerBucket.set(call.broker,[]);
      brokerBucket.get(call.broker).push({call,detailed:match.detailed});
    }
    const entries=map=>[...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([broker,items])=>({
      broker,
      detailed:items.every(item=>item.detailed),
      calls:items.map(item=>item.call).sort((a,b)=>b.call_date.localeCompare(a.call_date)||a.call.localeCompare(b.call)),
    }));
    const groups=SECTOR_GROUPS.map(group=>({name:group.name,rows:group.sectors.map(sector=>({
      sector,
      overweight:entries(buckets.get(`${sector}|overweight`)),
      underweight:entries(buckets.get(`${sector}|underweight`)),
    }))}));
    unmapped.sort((a,b)=>a.broker.localeCompare(b.broker)||a.type.localeCompare(b.type)||a.call.localeCompare(b.call));
    return {groups,unmapped,total_calls:calls.length,mapped_calls:calls.length-unmapped.length};
  }
  function annualSupplyRows(data){
    const year=String(data.reference_year);
    const selected={...data,calls:data.calls.filter(call=>call.target_date===year)};
    return groupCalls(selected,['Gross Supply','Hyperscaler Issuance']);
  }
  function latestCalls(data,type,targetDate){
    const latest=new Map();
    data.calls.filter(call=>call.asset==='US IG'&&call.type===type&&call.target_date===targetDate).forEach(call=>{
      const current=latest.get(call.broker);
      if(!current||call.call_date>current.call_date||(call.call_date===current.call_date&&call.as_of_date>current.as_of_date))latest.set(call.broker,call);
    });
    return latest;
  }
  function supplyMatrix(data,month){
    if(typeof month!=='string'||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Supply forecast 月份無效');
    const year=month.slice(0,4),monthNumber=Number(month.slice(5));
    const annual=latestCalls(data,'Gross Supply',year);
    const monthly=latestCalls(data,'Gross Supply',month);
    const hyperscaler=latestCalls(data,'Hyperscaler Issuance',year);
    const brokers=[...new Set([...annual.keys(),...monthly.keys(),...hyperscaler.keys()])].sort((a,b)=>a==='BofA'?-1:b==='BofA'?1:a.localeCompare(b));
    return {year,month,brokers,rows:[
      {key:'annual',label:`${year} Gross Supply`,calls:brokers.map(broker=>annual.get(broker)||null)},
      {key:'monthly',label:`${monthNumber} 月 Gross Supply`,calls:brokers.map(broker=>monthly.get(broker)||null)},
      {key:'hyperscaler',label:`${year} Hyperscaler Issuance`,calls:brokers.map(broker=>hyperscaler.get(broker)||null)},
    ]};
  }
  function usdBillions(value){
    if(typeof value!=='string')return null;
    const match=value.match(/^\$([0-9]+(?:\.[0-9]+)?)(Bn|Tn)$/i);
    if(!match)return null;
    const amount=Number(match[1])*(match[2].toLowerCase()==='tn'?1000:1);
    return Number.isFinite(amount)&&amount>0?amount:null;
  }
  function progressPercent(actualUsd,forecastCall){
    const forecastBillions=usdBillions(forecastCall?.call);
    if(!Number.isFinite(actualUsd)||actualUsd<0||forecastBillions===null)return null;
    return Math.round(actualUsd/1e9/forecastBillions*100);
  }
  return {SCHEMA_VERSION,ASSETS,TYPES,STATUSES,SECTOR_GROUPS,SECTOR_RULES,BROKER_SECTOR_RULES,validateManifest,validateFeed,sectorRows,resolveSector,sectorMatrix,annualSupplyRows,supplyMatrix,usdBillions,progressPercent};
});
