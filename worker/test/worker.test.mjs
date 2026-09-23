import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSession, handleRequest, publishLuacSnapshot, publishSnapshot, publishSupplySnapshot,
  status, statusLuac, statusSupply, validateLuacSnapshot, validateSnapshot,
  validateSupplySnapshot, verifySession,
} from '../src/index.js';
import worker from '../src/index.js';

const ORIGIN = 'https://creditbase02.github.io';
const SECTIONS = {
  Overview: ['JULI', 'Fin', 'Non-Fin', 'AA', 'A', 'BBB'],
  Cyclical: ['US Bank', 'Yankee Bank', 'Insurance', 'M&M', 'Chemical', 'Tech', 'Auto', 'Media', 'Energy', 'Capital Good'],
  'Non-Cyclical': ['Telecom', 'Utility', 'F&B', 'Tobacco', 'Healthcare', 'Retail', 'Transportation'],
};
const METRICS = ['Spread', '10Y', '30Y', '10s30s'];

function snapshot(date = '2026-08-06') {
  return {
    date,
    horizon: '2Y',
    sections: Object.fromEntries(Object.entries(SECTIONS).map(([section, sectors]) => [section,
      Object.fromEntries(METRICS.map(metric => [metric, sectors.map((sector, index) => ({
        sector,
        sources: {min: 'Excel', median: 'Excel', max: 'Excel', current: 'Excel', pct: 'Excel'},
        min: 10 + index,
        median: 20 + index,
        max: 30 + index,
        current: 25 + index,
        pct: 0.5,
      }))])),
    ])),
  };
}

const LUAC_COLUMNS = ['id','security_des','issuer','ticker','maturity','rating','maturity_years','oas_bp','yield_pct','industry','flags'];

function luacSnapshot(date = '2026-09-16', count = 25) {
  return {
    schema_version: 2,
    date,
    columns: LUAC_COLUMNS,
    peer_definitions: [{name: 'Fixture Banks', tickers: ['T0', 'T1']}],
    records: Array.from({length: count}, (_, index) => [
      `US000000${String(index).padStart(4, '0')}`,
      `TEST ${index} 5.0 09/15/30`,
      `Test Issuer ${index % 4}`,
      `T${index % 3}`,
      '2030-09-15',
      index % 2 ? 'BBB+' : 'A-',
      4 + index / 100,
      120 + index,
      index === count - 1 ? 55 : 5 + index / 100,
      'Technology',
      index === count - 1 ? ['yield_outlier'] : [],
    ]),
  };
}

function supplySnapshot(date = '2026-09-17', rowCount = 10, ytd = 1000) {
  const first = Math.floor(ytd * 0.4), second = Math.floor(ytd * 0.2), others = ytd - first - second;
  const emptyMonths = () => Array.from({length: 12}, () => []);
  const groupAMonths = emptyMonths(), groupBMonths = emptyMonths(), otherMonths = emptyMonths();
  groupAMonths[0] = [['AAA', first]];
  groupBMonths[0] = [['BBB', second]];
  otherMonths[0] = [['OTHER', others]];
  return {
    schema_version: 3, date, year: Number(date.slice(0, 4)), currency: 'USD',
    row_count: rowCount, ytd_usd: ytd, mtd_usd: ytd,
    breakdowns: {
      industry: [['Finance', ytd]],
      rating: [['A', first], ['BBB', ytd - first]],
      tenor: [['FRN', 0], ['3yr & In (1.5–3.5yr)', first], ['5yr (3.5–6yr)', second], ['7yr (6–8yr)', 0], ['10yr (8–12yr)', 0], ['20yr (12–22yr)', 0], ['30yr (22–32yr)', 0], ['>32yr (>32yr)', 0], ['Perpetual', others]],
      peer_group: [['Group A', first], ['Group B', second], ['Other IG', others]],
    },
    monthly: {
      total: [ytd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      peer_groups: [
        ['Group A', [first, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ['Group B', [second, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ['Other IG', [others, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      ],
    },
    peer_definitions: [{name: 'Group A', tickers: ['AAA']}, {name: 'Group B', tickers: ['BBB']}],
    peer_tickers: {'Group A': [['AAA', first]], 'Group B': [['BBB', second]]},
    top_tickers: {
      ytd: {
        industry: [['Finance', [['AAA', first]]]],
        rating: [['A', [['AAA', first]]], ['BBB', [['BBB', second]]]],
        peer_group: [['Group A', [['AAA', first]]], ['Group B', [['BBB', second]]], ['Other IG', [['OTHER', others]]]],
      },
      monthly: {
        total: [[['OTHER', others], ['AAA', first], ['BBB', second]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), ...emptyMonths().slice(1)],
        peer_groups: [['Group A', groupAMonths], ['Group B', groupBMonths], ['Other IG', otherMonths]],
      },
    },
    quality: {date_corrections: 5, duplicate_cusip_groups: 2},
  };
}

function limiter(success = true) {
  return {limit: async () => ({success})};
}

function env(overrides = {}) {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    UPLOAD_PASSWORD: 'correct horse',
    SESSION_SECRET: 'a-long-random-session-secret-for-tests',
    RV_UPLOAD_ENABLED: 'false',
    LOGIN_RATE_LIMITER: limiter(),
    PUBLISH_RATE_LIMITER: limiter(),
    ...overrides,
  };
}

function request(path, options = {}) {
  return new Request(`https://upload.example${path}`, {
    ...options,
    headers: {origin: ORIGIN, 'content-type': 'application/json', ...(options.headers || {})},
  });
}

test('strict snapshot contains exactly 460 Excel values', () => {
  assert.equal(validateSnapshot(snapshot()), 460);
  const missing = snapshot();
  missing.sections.Overview.Spread[0].current = null;
  assert.throws(() => validateSnapshot(missing), /current 無效/);
  const wrongSource = snapshot();
  wrongSource.sections.Overview.Spread[0].sources.min = '投影片';
  assert.throws(() => validateSnapshot(wrongSource), /只接受 Excel/);
  const wrongOrder = snapshot();
  wrongOrder.sections.Overview.Spread[0].min = 99;
  assert.throws(() => validateSnapshot(wrongOrder), /排序錯誤/);
  const outOfRange = snapshot();
  outOfRange.sections.Overview.Spread[0].pct = 1.1;
  assert.throws(() => validateSnapshot(outOfRange), /percentile 越界/);
});

test('strict LUAC snapshot validates flags, IDs, and finite numbers', () => {
  assert.deepEqual(validateLuacSnapshot(luacSnapshot()), {count: 25, anomalies: 1});
  const duplicate = luacSnapshot();
  duplicate.records[1][0] = duplicate.records[0][0];
  assert.throws(() => validateLuacSnapshot(duplicate), /ID 重複/);
  const wrongFlag = luacSnapshot();
  wrongFlag.records.at(-1)[10] = [];
  assert.throws(() => validateLuacSnapshot(wrongFlag), /異常標記不正確/);
  const notFinite = luacSnapshot();
  notFinite.records[0][7] = Number.POSITIVE_INFINITY;
  assert.throws(() => validateLuacSnapshot(notFinite), /數值或日期無效/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), date: '2026-02-31'}), /日期不正確/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), schema_version: 1}), /欄位不正確/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), peer_definitions: []}), /Peer Group 定義無效/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), peer_definitions: [{name: 'A', tickers: ['T0']}, {name: 'B', tickers: ['T0']}]}), /ticker 重複/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), peer_definitions: [{name: 'A', tickers: ['t0']}]}), /定義無效/);
  assert.throws(() => validateLuacSnapshot({...luacSnapshot(), peer_definitions: [{name: 'A', tickers: ['T0'], extra: true}]}), /定義無效/);
});

test('strict Supply snapshot validates exact reconciliation and safe metadata', () => {
  assert.deepEqual(validateSupplySnapshot(supplySnapshot()), {rows: 10, dateCorrections: 5, duplicateCusips: 2});
  const broken = supplySnapshot();
  broken.breakdowns.industry[0][1] -= 1;
  assert.throws(() => validateSupplySnapshot(broken), /無法勾稽 YTD/);
  const provenance = {...supplySnapshot(), source_file: 'private.xlsx'};
  assert.throws(() => validateSupplySnapshot(provenance), /欄位不正確/);
  assert.throws(() => validateSupplySnapshot({...supplySnapshot(), date: '2026-02-31'}), /欄位不正確/);
  for (const schema_version of [1, 2]) assert.throws(() => validateSupplySnapshot({...supplySnapshot(), schema_version}), /欄位不正確/);
  const legacy = supplySnapshot();
  legacy.schema_version = 2;
  const total = legacy.ytd_usd, first = Math.floor(total * 0.4), second = Math.floor(total * 0.2);
  legacy.breakdowns.tenor = [['FRN', 0], ['≤5Y', first], ['>5Y–10Y', second], ['>10Y / Perpetual', total - first - second]];
  assert.deepEqual(validateSupplySnapshot(legacy, true), {rows: 10, dateCorrections: 5, duplicateCusips: 2});
});

test('Supply Top 5 rejects duplicates, disorder, and per-security payloads', () => {
  const snapshot = supplySnapshot();
  const [[ticker, value]] = snapshot.top_tickers.ytd.industry[0][1];
  const duplicate = supplySnapshot();
  duplicate.top_tickers.ytd.industry[0][1] = [[ticker, value], [ticker, value]];
  assert.throws(() => validateSupplySnapshot(duplicate), /列無效/);
  const unordered = supplySnapshot();
  unordered.top_tickers.ytd.industry[0][1] = [['ZZZ', value], [ticker, value]];
  assert.throws(() => validateSupplySnapshot(unordered), /排序不正確/);
  const leaked = supplySnapshot();
  leaked.top_tickers.ytd.industry[0][1] = [[ticker, value, '912828XX1']];
  assert.throws(() => validateSupplySnapshot(leaked), /列無效/);
  const tooMany = supplySnapshot();
  tooMany.top_tickers.ytd.industry[0][1] = Array.from({length: 6}, (_, index) => [`T${index}`, value]);
  assert.throws(() => validateSupplySnapshot(tooMany), /Top 5 結構無效/);
  for (const field of ['CUSIP', 'BB ID', 'ISIN', 'Tranche Size', 'Pricing Date', 'workbook', '.xlsx']) {
    assert.equal(JSON.stringify(supplySnapshot()).includes(field), false, `${field} must not reach the public snapshot`);
  }
});

test('session tokens expire after 15 minutes and reject tampering', async () => {
  const now = Date.UTC(2026, 8, 11);
  const token = await createSession('secret', now);
  assert.equal(await verifySession(token, 'secret', now + 899000), true);
  assert.equal(await verifySession(token, 'secret', now + 901000), false);
  assert.equal(await verifySession(`${token}x`, 'secret', now), false);
});

test('health is public but cross-origin mutation is blocked', async () => {
  const health = await handleRequest(new Request('https://upload.example/health'), env());
  assert.equal(await health.text(), 'RV Upload Service OK');
  const blocked = await handleRequest(new Request('https://upload.example/session', {
    method: 'POST', headers: {origin: 'https://evil.example'}, body: JSON.stringify({password: 'correct horse'}),
  }), env());
  assert.equal(blocked.status, 403);
});

test('password, rate limit, and disabled publishing fail closed', async () => {
  const wrong = await handleRequest(request('/session', {method: 'POST', body: JSON.stringify({password: 'wrong'})}), env());
  assert.equal(wrong.status, 401);
  const limited = await handleRequest(request('/session', {method: 'POST', body: JSON.stringify({password: 'correct horse'})}), env({LOGIN_RATE_LIMITER: limiter(false)}));
  assert.equal(limited.status, 429);
  const login = await handleRequest(request('/session', {method: 'POST', body: JSON.stringify({password: 'correct horse'})}), env());
  const {token} = await login.json();
  const publish = await handleRequest(request('/publish', {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({data: snapshot()})}), env());
  assert.equal(publish.status, 503);
});

test('publish endpoint rejects expired sessions and non-data payloads', async () => {
  const expired = await createSession('a-long-random-session-secret-for-tests', Date.now() - 1000000);
  const response = await handleRequest(request('/publish', {method: 'POST', headers: {authorization: `Bearer ${expired}`}, body: '{}'}), env({RV_UPLOAD_ENABLED: 'true'}));
  assert.equal(response.status, 401);
  const token = await createSession('a-long-random-session-secret-for-tests');
  const raw = await handleRequest(request('/publish', {
    method: 'POST', headers: {authorization: `Bearer ${token}`},
    body: JSON.stringify({data: snapshot(), filename: 'secret.xlsx'}),
  }), env({RV_UPLOAD_ENABLED: 'true'}));
  assert.equal(raw.status, 400);
  assert.match((await raw.json()).error, /只接受公開摘要/);
});

test('LUAC publish is separately disabled and enforces the 4 MiB body limit', async () => {
  const token = await createSession('a-long-random-session-secret-for-tests');
  const disabled = await handleRequest(request('/publish/luac', {
    method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({data: luacSnapshot()}),
  }), env({RV_UPLOAD_ENABLED: 'true', LUAC_UPLOAD_ENABLED: 'false'}));
  assert.equal(disabled.status, 503);
  const oversized = await worker.fetch(request('/publish/luac', {
    method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-length': String(4 * 1024 * 1024 + 1)}, body: '{}',
  }), env({LUAC_UPLOAD_ENABLED: 'true'}));
  assert.equal(oversized.status, 413);
});

test('Supply publish is separately disabled and accepts only a data payload', async () => {
  const token = await createSession('a-long-random-session-secret-for-tests');
  const disabled = await handleRequest(request('/publish/supply', {
    method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({data: supplySnapshot()}),
  }), env({SUPPLY_UPLOAD_ENABLED: 'false'}));
  assert.equal(disabled.status, 503);
  const raw = await handleRequest(request('/publish/supply', {
    method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({data: supplySnapshot(), filename: 'private.xlsx'}),
  }), env({SUPPLY_UPLOAD_ENABLED: 'true'}));
  assert.equal(raw.status, 400);
  assert.match((await raw.json()).error, /只接受公開摘要/);
});

async function githubEnv(overrides = {}) {
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateKey).toString('base64')}\n-----END PRIVATE KEY-----`;
  return env({
    RV_UPLOAD_ENABLED: 'true', GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '456',
    GITHUB_APP_PRIVATE_KEY: pem, GITHUB_REPOSITORY: 'owner/repo',
    PUBLISH_MODE: 'preview', PREVIEW_BASE_REF: 'codex/rv-upload-portal',
    ...overrides,
  });
}

function apiJson(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
}

test('duplicate sanitized submission returns its existing PR', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push([String(url), options.method || 'GET']);
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/rv-data.json')) return apiJson({sha: 'file-sha', content: Buffer.from(JSON.stringify(snapshot('2026-08-05'))).toString('base64')});
    if (String(url).endsWith('/git/ref/heads/codex/rv-upload-portal')) return apiJson({object: {sha: 'base-sha'}});
    if (String(url).endsWith('/git/refs')) return apiJson({message: 'Reference already exists'}, 422);
    if (String(url).includes('/pulls?state=all')) return apiJson([{number: 73, state: 'open', merged_at: null}]);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    assert.deepEqual(await publishSnapshot(await githubEnv(), snapshot()), {id: '73', state: 'open'});
    assert.equal(calls.some(([url]) => url.includes('/pulls?state=all')), true);
  } finally { globalThis.fetch = savedFetch; }
});

test('a transferred App with one installation recovers from its retired installation ID', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value.endsWith('/app/installations/456/access_tokens')) return apiJson({message: 'Not Found'}, 404);
    if (value.endsWith('/app/installations')) return apiJson([{id: 789}]);
    if (value.endsWith('/app/installations/789/access_tokens')) return apiJson({token: 'new-installation'});
    if (value.includes('/contents/assets/rv-data.json')) return apiJson({sha: 'file-sha', content: Buffer.from(JSON.stringify(snapshot('2026-08-05'))).toString('base64')});
    if (value.endsWith('/git/ref/heads/codex/rv-upload-portal')) return apiJson({object: {sha: 'base-sha'}});
    if (value.endsWith('/git/refs')) return apiJson({message: 'Reference already exists'}, 422);
    if (value.includes('/pulls?state=all')) return apiJson([{number: 73, state: 'open', merged_at: null}]);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    assert.deepEqual(await publishSnapshot(await githubEnv(), snapshot()), {id: '73', state: 'open'});
    assert.equal(calls.includes('https://api.github.com/app/installations'), true);
    assert.equal(calls.includes('https://api.github.com/app/installations/789/access_tokens'), true);
  } finally { globalThis.fetch = savedFetch; }
});

test('successful publish writes only sanitized rv-data and labels one PR', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({url: String(url), method, body: options.body});
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/rv-data.json') && method === 'GET') return apiJson({sha: 'file-sha', content: Buffer.from(JSON.stringify(snapshot('2026-08-05'))).toString('base64')});
    if (String(url).endsWith('/git/ref/heads/codex/rv-upload-portal')) return apiJson({object: {sha: 'base-sha'}});
    if (String(url).endsWith('/git/refs') && method === 'POST') return apiJson({ref: 'created'});
    if (String(url).includes('/contents/assets/rv-data.json') && method === 'PUT') return apiJson({content: {sha: 'new-file'}});
    if (String(url).endsWith('/pulls') && method === 'POST') return apiJson({number: 74});
    if (String(url).endsWith('/issues/74/labels') && method === 'POST') return apiJson([{name: 'automated-rv-data'}]);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    assert.deepEqual(await publishSnapshot(await githubEnv(), snapshot()), {id: '74', state: 'pending'});
    const update = calls.find(call => call.url.includes('/contents/assets/rv-data.json') && call.method === 'PUT');
    assert.ok(update);
    assert.deepEqual(Object.keys(JSON.parse(update.body)).sort(), ['branch', 'content', 'message', 'sha']);
    assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(calls.some(call => call.url.endsWith('/issues/74/labels')), true);
    const label = calls.find(call => call.url.endsWith('/issues/74/labels'));
    assert.deepEqual(JSON.parse(label.body), {labels: ['rv-data-preview']});
    const updateBody = JSON.parse(update.body);
    assert.match(updateBody.branch, /^preview\/rv-data-/);
    const pull = calls.find(call => call.url.endsWith('/pulls') && call.method === 'POST');
    assert.equal(JSON.parse(pull.body).base, 'codex/rv-upload-portal');
  } finally { globalThis.fetch = savedFetch; }
});

test('GitHub update failure cleans up the automation branch', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push([String(url), method]);
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/rv-data.json') && method === 'GET') return apiJson({sha: 'file-sha', content: Buffer.from(JSON.stringify(snapshot('2026-08-05'))).toString('base64')});
    if (String(url).endsWith('/git/ref/heads/codex/rv-upload-portal')) return apiJson({object: {sha: 'base-sha'}});
    if (String(url).endsWith('/git/refs') && method === 'POST') return apiJson({ref: 'created'});
    if (String(url).includes('/contents/assets/rv-data.json') && method === 'PUT') return apiJson({message: 'boom'}, 500);
    if (String(url).includes('/git/refs/heads/preview/') && method === 'DELETE') return apiJson({});
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    await assert.rejects(publishSnapshot(await githubEnv(), snapshot()), /boom/);
    assert.equal(calls.some(([url, method]) => url.includes('/git/refs/heads/preview/') && method === 'DELETE'), true);
  } finally { globalThis.fetch = savedFetch; }
});

test('production LUAC publish allows a same-day correction and writes exactly one asset', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({url: String(url), method, body: options.body});
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/luac-bonds.json') && method === 'GET') {
      return apiJson({sha: 'luac-file-sha', encoding: 'none'});
    }
    if (String(url).endsWith('/git/blobs/luac-file-sha')) return apiJson({content: Buffer.from(JSON.stringify(luacSnapshot('2026-09-15'))).toString('base64')});
    if (String(url).endsWith('/git/ref/heads/main')) return apiJson({object: {sha: 'base-sha'}});
    if (String(url).endsWith('/git/refs') && method === 'POST') return apiJson({ref: 'created'});
    if (String(url).includes('/contents/assets/luac-bonds.json') && method === 'PUT') return apiJson({content: {sha: 'new-luac-file'}});
    if (String(url).endsWith('/pulls') && method === 'POST') return apiJson({number: 81});
    if (String(url).endsWith('/issues/81/labels') && method === 'POST') return apiJson([{name: 'automated-luac-data'}]);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    assert.deepEqual(await publishLuacSnapshot(await githubEnv({PUBLISH_MODE: 'production', LUAC_UPLOAD_ENABLED: 'true'}), luacSnapshot('2026-09-15')), {id: '81', state: 'pending'});
    const updates = calls.filter(call => call.method === 'PUT');
    assert.equal(updates.length, 1);
    assert.match(updates[0].url, /assets\/luac-bonds\.json$/);
    const update = JSON.parse(updates[0].body);
    assert.match(update.branch, /^automation\/luac-data-/);
    assert.deepEqual(JSON.parse(Buffer.from(update.content, 'base64').toString()).columns, LUAC_COLUMNS);
    const label = calls.find(call => call.url.endsWith('/issues/81/labels'));
    assert.deepEqual(JSON.parse(label.body), {labels: ['automated-luac-data']});
  } finally { globalThis.fetch = savedFetch; }
});

test('production Supply publish allows same-day correction and writes one compact asset', async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({url: String(url), method, body: options.body});
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/supply-data.json') && method === 'GET') return apiJson({sha: 'supply-file-sha', content: Buffer.from(JSON.stringify(supplySnapshot())).toString('base64')});
    if (String(url).endsWith('/git/ref/heads/main')) return apiJson({object: {sha: 'base-sha'}});
    if (String(url).endsWith('/git/refs') && method === 'POST') return apiJson({ref: 'created'});
    if (String(url).includes('/contents/assets/supply-data.json') && method === 'PUT') return apiJson({content: {sha: 'new-supply-file'}});
    if (String(url).endsWith('/pulls') && method === 'POST') return apiJson({number: 82});
    if (String(url).endsWith('/issues/82/labels') && method === 'POST') return apiJson([{name: 'automated-supply-data'}]);
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    assert.deepEqual(await publishSupplySnapshot(await githubEnv({PUBLISH_MODE: 'production', SUPPLY_UPLOAD_ENABLED: 'true'}), supplySnapshot()), {id: '82', state: 'pending'});
    const updates = calls.filter(call => call.method === 'PUT');
    assert.equal(updates.length, 1);
    assert.match(updates[0].url, /assets\/supply-data\.json$/);
    const update = JSON.parse(updates[0].body);
    assert.match(update.branch, /^automation\/supply-data-/);
    assert.equal(JSON.parse(Buffer.from(update.content, 'base64').toString()).row_count, 10);
    assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/issues/82/labels')).body), {labels: ['automated-supply-data']});
  } finally { globalThis.fetch = savedFetch; }
});

test('Supply publish rejects row or YTD drift above 20 percent', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/supply-data.json')) return apiJson({sha: 'supply-file-sha', content: Buffer.from(JSON.stringify(supplySnapshot())).toString('base64')});
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    await assert.rejects(publishSupplySnapshot(await githubEnv({PUBLISH_MODE: 'production'}), supplySnapshot('2026-09-18', 13, 1000)), /20%/);
    await assert.rejects(publishSupplySnapshot(await githubEnv({PUBLISH_MODE: 'production'}), supplySnapshot('2026-09-18', 10, 1300)), /20%/);
  } finally { globalThis.fetch = savedFetch; }
});

test('LUAC publish rejects record-count drift above 20 percent', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).includes('/contents/assets/luac-bonds.json')) {
      return apiJson({sha: 'luac-file-sha', content: Buffer.from(JSON.stringify(luacSnapshot('2026-09-15', 20))).toString('base64')});
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    await assert.rejects(publishLuacSnapshot(await githubEnv({PUBLISH_MODE: 'production'}), luacSnapshot('2026-09-16', 25)), /超過 ±20%/);
  } finally { globalThis.fetch = savedFetch; }
});

test('status reports deployed only after the public PASS manifest matches', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).endsWith('/pulls/74')) return apiJson({state: 'closed', merged_at: '2026-09-11T00:00:00Z', merge_commit_sha: 'merge-sha', title: 'Update RV data to 2026-08-06'});
    if (String(url).startsWith('https://public.example/manifest.json')) return apiJson({validation_status: 'PASS', content_as_of: '2026-08-06', commit_sha: 'merge-sha'});
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const result = await status({...await githubEnv(), PUBLIC_MANIFEST_URL: 'https://public.example/manifest.json'}, '74');
    assert.equal(result.state, 'deployed');
  } finally { globalThis.fetch = savedFetch; }
});

test('LUAC status reads the additive manifest dataset date', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).endsWith('/pulls/81')) return apiJson({state: 'closed', merged_at: '2026-09-16T00:00:00Z', merge_commit_sha: 'luac-merge', title: 'Update LUAC data to 2026-09-16'});
    if (String(url).startsWith('https://public.example/manifest.json')) return apiJson({validation_status: 'PASS', commit_sha: 'luac-merge', datasets: {luac: {content_as_of: '2026-09-16'}}});
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const result = await statusLuac({...await githubEnv(), PUBLIC_MANIFEST_URL: 'https://public.example/manifest.json'}, '81');
    assert.equal(result.state, 'deployed');
  } finally { globalThis.fetch = savedFetch; }
});

test('Supply status reads its additive manifest dataset date', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/access_tokens')) return apiJson({token: 'installation'});
    if (String(url).endsWith('/pulls/82')) return apiJson({state: 'closed', merged_at: '2026-09-17T00:00:00Z', merge_commit_sha: 'supply-merge', title: 'Update Supply data to 2026-09-17'});
    if (String(url).startsWith('https://public.example/manifest.json')) return apiJson({validation_status: 'PASS', commit_sha: 'supply-merge', datasets: {supply: {content_as_of: '2026-09-17'}}});
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const result = await statusSupply({...await githubEnv(), PUBLIC_MANIFEST_URL: 'https://public.example/manifest.json'}, '82');
    assert.equal(result.state, 'deployed');
  } finally { globalThis.fetch = savedFetch; }
});
