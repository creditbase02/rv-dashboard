const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const model = require('../assets/supply-model.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'supply-data.json'), 'utf8'));

const clone = value => structuredClone(value);

test('Supply browser model accepts the approved compact snapshot', () => {
  assert.ok([2,3].includes(data.schema_version));
  assert.equal(model.validateSnapshot(clone(data)).row_count, 1639);
  if(data.schema_version===3)assert.deepEqual(data.breakdowns.tenor.map(row => row[0]), model.TENOR_BUCKETS);
  for (const field of ['industry', 'rating', 'tenor']) {
    assert.equal(model.reconciledPercentages(data.breakdowns[field], data.ytd_usd).reduce((a, b) => a + b, 0), 10000);
  }
});

test('Supply browser model validates Top 5 and Other IG naming', () => {
  assert.equal(data.breakdowns.peer_group.at(-1)[0], 'Other IG');
  assert.equal(JSON.stringify(data).includes('Others'), false);
  const broken = clone(data);
  broken.top_tickers.ytd.industry[0][1].reverse();
  assert.throws(() => model.validateSnapshot(broken), /排序/);
  const unsupported = clone(data);
  unsupported.schema_version = 1;
  assert.throws(() => model.validateSnapshot(unsupported), /schema_version/);

  const duplicate = clone(data);
  const duplicatePairs = duplicate.top_tickers.ytd.industry[0][1];
  duplicatePairs[duplicatePairs.length - 1] = [...duplicatePairs[0]];
  assert.throws(() => model.validateSnapshot(duplicate), /列無效/);

  const leaked = clone(data);
  leaked.top_tickers.ytd.industry[0][1][0].push('912828XX1');
  assert.throws(() => model.validateSnapshot(leaked), /列無效/);

  const tooMany = clone(data);
  tooMany.top_tickers.ytd.industry[0][1] = Array.from({length:6},(_,index)=>[`T${index}`,1]);
  assert.throws(() => model.validateSnapshot(tooMany), /Top 5 結構無效/);

  const text = JSON.stringify(data);
  for(const field of ['CUSIP','BB ID','ISIN','Tranche Size','Pricing Date','source_file','workbook','.xlsx']) assert.equal(text.includes(field),false,`${field} 不可出現在公開快照`);
});

test('Supply browser model rejects broken reconciliation and ordering', () => {
  const industry = clone(data);
  industry.breakdowns.industry[0][1] = 0;
  assert.throws(() => model.validateSnapshot(industry), /無法勾稽 YTD/);

  const tenor = clone(data);
  tenor.breakdowns.tenor.reverse();
  assert.throws(() => model.validateSnapshot(tenor), /Tenor 順序/);

  const rating = clone(data);
  rating.breakdowns.rating.reverse();
  assert.throws(() => model.validateSnapshot(rating), /Rating 順序/);

  const monthly = clone(data);
  monthly.monthly.peer_groups[0][1][0] += 1;
  assert.throws(() => model.validateSnapshot(monthly), /無法勾稽/);
});

test('Supply browser model rejects provenance fields and peer conflicts', () => {
  const provenance = clone(data);
  provenance.source_file = 'private.xlsx';
  assert.throws(() => model.validateSnapshot(provenance), /結構不正確/);

  const peer = clone(data);
  peer.peer_definitions[1].tickers.push(peer.peer_definitions[0].tickers[0]);
  assert.throws(() => model.validateSnapshot(peer), /ticker 無效/);
});
