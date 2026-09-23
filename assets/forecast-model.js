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
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|');
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  const text=(value,max=2000)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
  const httpsUrl=value=>{try{return typeof value==='string'&&new URL(value).protocol==='https:';}catch{return false;}};

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
  function annualSupplyRows(data){
    const year=String(data.reference_year);
    const selected={...data,calls:data.calls.filter(call=>call.target_date===year)};
    return groupCalls(selected,['Gross Supply','Hyperscaler Issuance']);
  }
  return {SCHEMA_VERSION,ASSETS,TYPES,STATUSES,validateManifest,validateFeed,sectorRows,annualSupplyRows};
});
