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
