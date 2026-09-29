import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,reconcile,TENOR_BUCKETS} from '../src/supply-lock.js';
import {identity,digest,signSnapshot,verifySnapshot,verifyTransition} from '../src/supply-proof.js';
import {prepareLockedSupply,validateSupplySnapshot} from '../src/index.js';
const definitions=[{name:'Banks',tickers:['ABC']}];
async function record(name,usd=100,date='2026-09-24'){
  return {id:await identity('id:'+name),cusip:await identity('cusip:'+name),security:await identity('security:'+name),ticker:name,usd,date,tenor:TENOR_BUCKETS[2],industry:'Financial',rating:'A'};
}
const old=await record('ABC',10000),fresh=await record('NEW',1000,'2026-09-28');
const baseline={version:'synthetic-v1',through:'2026-09-25',records:[old],aliases:[],peer_definitions:definitions,date_corrections:0,approved_events:[]};
const input=(records=[old,fresh])=>({baseline_version:baseline.version,as_of:'2026-09-28',complete:true,records:structuredClone(records)});
const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const privateKey=await crypto.subtle.exportKey('jwk',keys.privateKey);
const config={version:baseline.version,through:baseline.through,public_key:await crypto.subtle.exportKey('jwk',keys.publicKey)};
const serviceBaseline={...baseline,records:await Promise.all(Array.from({length:10},(_,i)=>record(i?'BANK'+i:'ABC',1000)))};
const initial=await signSnapshot(aggregate(serviceBaseline.records,definitions,baseline.through),config,'0'.repeat(64),privateKey);
const store=new Map([[`baseline:${baseline.version}`,serviceBaseline]]);
const env=()=>({SUPPLY_SIGNING_KEY:JSON.stringify(privateKey),SUPPLY_PRIVATE:{get:async k=>structuredClone(store.get(k)??null),put:async(k,v)=>store.set(k,JSON.parse(v))}});

test('locked amounts, dates within cutoff, classifications and missing rows cannot change baseline',()=>{
  const changed={...old,usd:1,date:'2026-01-01',industry:'Changed',rating:'NR',tenor:null,ticker:'OTHER'};
  for(const rows of [[changed,fresh],[fresh],[fresh,changed]]){
    const {data}=reconcile(baseline,input(rows));
    assert.equal(data.ytd_usd,11000);assert.equal(data.mtd_usd,11000);
    assert.deepEqual(data.breakdowns.peer_group,[['Banks',10000],['Other IG',1000]]);
  }
});
test('changed historical date cannot escape the identity lock; unchanged known bad original date is ignored',()=>{
  assert.throws(()=>reconcile(baseline,input([{...old,date:'2026-09-28'}])),/改期或增額/);
  assert.throws(()=>reconcile(baseline,input([{...old,id:fresh.id,date:'2026-09-28'}])),/改期或增額/);
  const b={...baseline,aliases:[{...old,date:'2029-07-27'}]};
  assert.equal(reconcile(b,input([{...old,date:'2029-07-27'},fresh])).data.ytd_usd,11000);
});
test('same CUSIP tap requires explicit event review and then adds only incremental principal',()=>{
  const tap={...fresh,cusip:old.cusip};
  assert.throws(()=>reconcile(baseline,input([old,tap])),/改期或增額/);
  assert.equal(reconcile({...baseline,approved_events:[tap]},input([old,tap])).data.ytd_usd,11000);
});
test('tail replacement is idempotent; duplicates, missing events and date changes are rejected',()=>{
  const once=reconcile(baseline,input());const twice=reconcile(baseline,input(),once.tail);
  assert.deepEqual(once,twice);
  assert.throws(()=>reconcile(baseline,input([old,fresh,fresh])),/事件重複/);
  assert.throws(()=>reconcile(baseline,input([old]),once.tail),/缺列或改期/);
  assert.throws(()=>reconcile(baseline,input([{...fresh,date:'2026-09-27'}]),once.tail),/缺列或改期/);
  assert.equal(reconcile(baseline,input([{...fresh,usd:1200}]),once.tail).data.ytd_usd,11200);
});
test('complete period, real dates, matching version, missing baseline and cross-year fail closed',()=>{
  assert.throws(()=>reconcile(null,input()),/基準缺失/);
  assert.throws(()=>reconcile(baseline,{...input(),baseline_version:'wrong'}),/版本不符/);
  for(const patch of [{complete:false},{as_of:'2026-09-31'},{as_of:'2027-01-01'}])assert.throws(()=>reconcile(baseline,{...input(),...patch}));
  assert.throws(()=>reconcile(baseline,input([{...fresh,date:'2025-01-01'}])),/定價日/);
});
test('Top 5 recomputes from all issuers, including issuer formerly outside top five',async()=>{
  const rows=await Promise.all(['A','B','C','D','E','F'].map((n,i)=>record(n,100-i)));
  const extra=await record('F',20,'2026-09-28');extra.id=await identity('F-tap');
  const before=aggregate(rows,definitions,'2026-09-25');const after=aggregate([...rows,extra],definitions,'2026-09-28');
  assert.ok(!before.top_tickers.monthly.total[8].some(([n])=>n==='F'));
  assert.deepEqual(after.top_tickers.monthly.total[8][0],['F',115]);
  validateSupplySnapshot(after);
});
test('month rollover resets MTD while locked September stays unchanged',()=>{
  const october={...fresh,date:'2026-10-01'};
  const {data}=reconcile(baseline,{...input([october]),as_of:'2026-10-01'});
  assert.equal(data.mtd_usd,1000);assert.equal(data.monthly.total[8],10000);assert.equal(data.ytd_usd,11000);
});
test('server signs only merged baseline, persists private tail and enforces current parent',async()=>{
  const upload={...input(),parent:await digest(initial)};
  const result=await prepareLockedSupply(env(),upload,initial,true,config);
  assert.equal(result.data.ytd_usd,11000);await verifySnapshot(result.data,config);
  assert.deepEqual(store.get(`tail:${await digest(result.data)}`),[fresh]);
  await assert.rejects(prepareLockedSupply(env(),upload,result.data,false,config),/線上版本已變動/);
  await assert.rejects(prepareLockedSupply(env(),{...input([old]),parent:await digest(result.data)},result.data,false,config),/缺列或改期/);
  await assert.rejects(prepareLockedSupply({},upload,initial,false,config),/尚未配置/);
});
test('signature binds every aggregate, cutoff and parent; unconfigured history fails closed',async()=>{
  await verifySnapshot(initial,config);
  for(const mutate of [d=>d.ytd_usd++,d=>d.monthly.total[8]++,d=>d.lock.through='2026-09-26',d=>d.lock.parent='1'.repeat(64)]){
    const copy=structuredClone(initial);mutate(copy);await assert.rejects(verifySnapshot(copy,config));
  }
  const result=await prepareLockedSupply(env(),{...input(),parent:await digest(initial)},initial,false,config);
  const broken=env();broken.SUPPLY_PRIVATE.get=async k=>k.startsWith('baseline:')?serviceBaseline:null;
  await assert.rejects(prepareLockedSupply(broken,{...input(),parent:await digest(result.data)},result.data,false,config),/前版核對紀錄缺失/);
});
test('private record fields never appear in public snapshot',()=>{
  const serialized=JSON.stringify(reconcile(baseline,input()).data);
  for(const r of [old,fresh])for(const k of ['id','cusip','security'])assert.ok(!serialized.includes(r[k]));
  assert.ok(!serialized.includes('records'));
});
test('server retains the 20 percent drift gate after baseline merging',async()=>{
  const oversized={...fresh,usd:5000};
  await assert.rejects(prepareLockedSupply(env(),{...input([oversized]),parent:await digest(initial)},initial,false,config),/20%/);
  const tooMany=await Promise.all(['NEW1','NEW2','NEW3'].map(n=>record(n,10,'2026-09-28')));
  await assert.rejects(prepareLockedSupply(env(),{...input(tooMany),parent:await digest(initial)},initial,false,config),/20%/);
});
test('two unreviewed rows for the same new CUSIP cannot double count under different IDs',()=>{
  const duplicate={...fresh,id:'f'.repeat(64)};
  assert.throws(()=>reconcile(baseline,input([fresh,duplicate])),/同券多次發行/);
});

test('CI refuses a correctly signed result based on an outdated parent',async()=>{
  const a=await signSnapshot(aggregate([...serviceBaseline.records,fresh],definitions,'2026-09-28'),config,await digest(initial),privateKey);
  const b=await signSnapshot(aggregate([...serviceBaseline.records,{...fresh,usd:1100}],definitions,'2026-09-28'),config,await digest(initial),privateKey);
  await verifyTransition(a,initial,config);
  await verifySnapshot(b,config);
  await assert.rejects(verifyTransition(b,a,config),/過期版本/);
});
