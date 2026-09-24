const assert=require('node:assert/strict');
const test=require('node:test');
const model=require('../assets/forecast-model.js');

const call=(overrides={})=>({broker:'BofA',asset:'US IG',type:'Gross Supply',call:'$2.1Tn',target_date:'2026',call_date:'2026-08-14',as_of_date:'2026-09-18',status:'Carried',note:'Annual forecast',source_url:'https://creditbase02.github.io/ib-knowledge-base/reports/bofa/',...overrides});
const feed=(calls=[call()])=>({schema_version:1,site_id:'ib-knowledge-base',content_as_of:'2026-09-18',reference_year:2026,source_url:'https://creditbase02.github.io/ib-knowledge-base/forecast/',calls});
const manifest=(forecast={asset:'forecast-calls.json',schema_version:1,content_as_of:'2026-09-18',sha256:'a'.repeat(64)})=>({schema_version:1,site_id:'ib-knowledge-base',production_url:'https://creditbase02.github.io/ib-knowledge-base/',validation_status:'PASS',datasets:{forecast}});

test('forecast manifest supports an absent dataset and resolves a safe asset',()=>{
  assert.equal(model.validateManifest({...manifest(),datasets:{}}),null);
  const resolved=model.validateManifest(manifest());
  assert.equal(resolved.url,'https://creditbase02.github.io/ib-knowledge-base/forecast-calls.json');
  assert.equal(resolved.version,'a'.repeat(64));
  assert.throws(()=>model.validateManifest(manifest({...manifest().datasets.forecast,asset:'../private.json'})),/asset/);
  assert.throws(()=>model.validateManifest(manifest({...manifest().datasets.forecast,schema_version:2})),/manifest/);
});

test('forecast feed validates strict public fields and source origin',()=>{
  assert.equal(model.validateFeed(feed(),'https://creditbase02.github.io').calls.length,1);
  const extra=feed();extra.calls[0].source_report='private.md';
  assert.throws(()=>model.validateFeed(extra),/欄位/);
  assert.throws(()=>model.validateFeed(feed([call({status:'Superseded'})])),/內容/);
  assert.throws(()=>model.validateFeed(feed([call({source_url:'https://evil.example/reports/a/'})])) ,/source_url/);
  const wrong={...feed(),schema_version:2};
  assert.throws(()=>model.validateFeed(wrong),/結構/);
});

test('forecast selectors group sectors and current-year supply without aggregation',()=>{
  const data=feed([
    call({type:'Overweight Sector',call:'Utilities',target_date:'',status:'Latest'}),
    call({type:'Underweight Sector',call:'Health Care',target_date:'',status:'Latest'}),
    call(),
    call({type:'Hyperscaler Issuance',call:'$330Bn',target_date:'2026',call_date:'2026-09-18',status:'Latest'}),
    call({type:'Hyperscaler Issuance',call:'-20%',target_date:'2027',call_date:'2026-09-18',status:'Latest'}),
    call({broker:'JPM',asset:'EUR IG',type:'Gross Supply',call:'€730Bn'}),
  ]);
  const sectors=model.sectorRows(data);
  assert.deepEqual(sectors.map(row=>row.broker),['BofA']);
  assert.deepEqual(sectors[0].overweight.map(item=>item.call),['Utilities']);
  assert.deepEqual(sectors[0].underweight.map(item=>item.call),['Health Care']);
  const supply=model.annualSupplyRows(data);
  assert.deepEqual(supply.map(row=>row.broker),['BofA']);
  assert.deepEqual(supply[0].gross_supply.map(item=>item.call),['$2.1Tn']);
  assert.deepEqual(supply[0].hyperscaler.map(item=>item.call),['$330Bn']);
});

test('sector matrix maps aliases, preserves detail, and retains every unknown call',()=>{
  const data=feed([
    call({broker:'New Broker',type:'Overweight Sector',call:'  utilities  ',target_date:'',status:'Latest'}),
    call({broker:'BofA',type:'Overweight Sector',call:'Energy',target_date:'',status:'Latest'}),
    call({broker:'BofA',type:'Overweight Sector',call:'Pipelines',target_date:'',status:'Latest'}),
    call({broker:'BofA',type:'Underweight Sector',call:'Energy Services',target_date:'',status:'Latest'}),
    call({broker:'TD',type:'Overweight Sector',call:'Life Insurance',target_date:'',status:'Latest'}),
    call({broker:'JPM',type:'Underweight Sector',call:'Consumer',target_date:'',status:'Latest'}),
  ]);
  const matrix=model.sectorMatrix(data);
  const cyclical=matrix.groups.find(group=>group.name==='Cyclical');
  const nonCyclical=matrix.groups.find(group=>group.name==='Non-Cyclical');
  const energy=cyclical.rows.find(row=>row.sector==='Energy');
  const insurance=cyclical.rows.find(row=>row.sector==='Insurance');
  const utility=nonCyclical.rows.find(row=>row.sector==='Utility');
  assert.equal(matrix.groups.flatMap(group=>group.rows).length,17);
  assert.deepEqual(utility.overweight.map(entry=>entry.broker),['New Broker']);
  assert.equal(energy.overweight[0].calls.length,2);
  assert.equal(energy.overweight[0].detailed,false,'a broad call prevents the merged label from being marked detail-only');
  assert.equal(energy.underweight[0].detailed,true);
  assert.equal(insurance.overweight[0].detailed,true);
  assert.deepEqual(matrix.unmapped.map(item=>item.call),['Consumer']);
  assert.equal(matrix.mapped_calls+matrix.unmapped.length,matrix.total_calls);
});

test('broker-specific sector rules take priority over common aliases',()=>{
  const data=feed([call({broker:'BofA',type:'Overweight Sector',call:'Utilities',target_date:'',status:'Latest'})]);
  const matrix=model.sectorMatrix(data,{bofa:{utilities:{sector:'Energy',detailed:true}}});
  const cyclical=matrix.groups.find(group=>group.name==='Cyclical');
  const nonCyclical=matrix.groups.find(group=>group.name==='Non-Cyclical');
  assert.equal(cyclical.rows.find(row=>row.sector==='Energy').overweight[0].broker,'BofA');
  assert.equal(cyclical.rows.find(row=>row.sector==='Energy').overweight[0].detailed,true);
  assert.equal(nonCyclical.rows.find(row=>row.sector==='Utility').overweight.length,0);
});

test('supply matrix transposes brokers, includes the snapshot month, and keeps the latest call',()=>{
  const data=feed([
    call(),
    call({type:'Gross Supply',call:'$175Bn',target_date:'2026-09',call_date:'2026-08-28'}),
    call({type:'Gross Supply',call:'$190Bn',target_date:'2026-09',call_date:'2026-09-04'}),
    call({broker:'GS',type:'Gross Supply',call:'$2.3Tn',target_date:'2026',call_date:'2026-09-11'}),
    call({broker:'TD',type:'Gross Supply',call:'$245-255Bn',target_date:'2026-09',call_date:'2026-08-21'}),
    call({broker:'JPM',type:'Hyperscaler Issuance',call:'$230Bn',target_date:'2026',call_date:'2026-09-18'}),
  ]);
  const matrix=model.supplyMatrix(data,'2026-09');
  assert.deepEqual(matrix.brokers,['BofA','GS','JPM','TD']);
  assert.deepEqual(matrix.rows.map(row=>row.label),['2026 Gross Supply','9 月 Gross Supply','2026 Hyperscaler Issuance']);
  assert.equal(matrix.rows[1].calls[0].call,'$190Bn');
  assert.equal(matrix.rows[0].calls[1].call,'$2.3Tn');
  assert.equal(matrix.rows[2].calls[2].call,'$230Bn');
  assert.equal(matrix.rows[0].calls[3],null);
  assert.throws(()=>model.supplyMatrix(data,'2026-13'),/月份/);
});

test('BofA comparison parses explicit USD forecasts and computes rounded progress',()=>{
  assert.equal(model.usdBillions('$190Bn'),190);
  assert.equal(model.usdBillions('$2.1Tn'),2100);
  assert.equal(model.progressPercent(1646875719000,call({call:'$2.1Tn'})),78);
  assert.equal(model.progressPercent(157550000000,call({call:'$190Bn'})),83);
  for(const value of ['$245-255Bn','>$2Tn','190Bn','-20%'])assert.equal(model.usdBillions(value),null);
  assert.equal(model.progressPercent(100e9,call({call:'$245-255Bn'})),null);
});
