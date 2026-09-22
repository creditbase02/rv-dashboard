const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const model = require('../assets/supply-model.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'supply-data.json'), 'utf8'));

const clone = value => structuredClone(value);

test('Supply browser model accepts the approved compact snapshot', () => {
  assert.equal(model.validateSnapshot(clone(data)).row_count, 1606);
  assert.deepEqual(data.breakdowns.tenor.map(row => row[0]), model.TENOR_BUCKETS);
  for (const field of ['industry', 'rating', 'tenor']) {
    assert.equal(model.reconciledPercentages(data.breakdowns[field], data.ytd_usd).reduce((a, b) => a + b, 0), 10000);
  }
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
