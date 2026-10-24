(() => {
  'use strict';
  const token = new URLSearchParams(location.hash.slice(1)).get('bbg-token');
  const button = document.getElementById('fetch-snapshot');
  const check = document.getElementById('check-connection');
  const badge = document.getElementById('connection-badge');
  const status = document.getElementById('lab-status');
  let ready = false, busy = false, hasSnapshot = false;
  if (token) document.querySelector('.lab-brand').href = location.hash;
  const messages = {
    preview_disabled:'本機 API 預覽尚未啟用，請使用 BQL 預覽啟動器。',
    supported_runtime_unconfirmed:'本機 BQL 執行環境尚未確認。',
    bql_runtime_unavailable:'目前選用的 Python 環境缺少 BQL 取數套件。',
    bql_runtime_failed:'無法啟動本機 BQL 取數環境。',
    terminal_connection:'Bloomberg 尚未登入或服務無法連線。',
    not_authorized:'目前帳號沒有這次查詢所需的資料權限。',
    query_timeout:'本次查詢已逾時並停止，沒有重試。',
    probe_busy:'另一個診斷正在執行，這次沒有送出市場查詢。',
    market_date_unverified:'行情日期無法確認，未載入資料。',
    mixed_market_dates:'回傳行情日期不一致，未載入資料。',
    partial_response:'回傳資料不完整，未載入資料。',
    missing_fields:'必要欄位缺值，未載入資料。',
    duplicate_id:'回傳重複單券 ID，未載入資料。',
    bql_response_shape:'回傳格式不符，未載入資料。',
    invalid_snapshot:'快照未通過資料結構或數值檢查。',
    snapshot_too_large:'快照超過本機預覽大小上限。',
    bql_query_failed:'BQL 查詢失敗，這次沒有重試。',
    unauthorized:'本機連線憑證已失效，請重新使用啟動器開啟頁面。',
  };
  const explain = code => messages[code] || '本次取數未完成，請核對 Bloomberg 與本機服務。';
  function display(kind, text) { status.className = `lab-status ${kind}`; status.textContent = text; }
  function sync() { button.disabled = !ready || busy; check.disabled = busy; button.textContent = busy ? '正在取得快照，請稍候…' : hasSnapshot ? '手動取得下一份快照 ↗' : '取得一次 BQL 快照 ↗'; }
  async function request(path) {
    const response = await fetch(`http://127.0.0.1:8768${path}`, {
      method:path === '/health' ? 'GET' : 'POST',
      headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'},
      ...(path === '/health' ? {} : {body:'{}'}),
      signal:AbortSignal.timeout(path === '/health' ? 20000 : 280000),
      cache:'no-store',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(explain(result.error));
    return result;
  }
  async function connection() {
    if (busy) return;
    ready = false; check.disabled = true; button.disabled = true; badge.classList.remove('connected');
    if (!token) { badge.textContent = '需要啟動器'; display('warning','請使用 BQL 預覽啟動器開啟此頁，才能連線 Bloomberg。原有 Excel 更新入口仍可使用。'); check.disabled = false; return; }
    try {
      const result = await request('/health');
      ready = result.ready === true && result.preview_enabled === true;
      badge.textContent = ready ? '本機服務就緒' : '本機環境未就緒';
      badge.classList.toggle('connected',ready);
      display(ready ? 'neutral' : 'warning',ready ? (hasSnapshot ? '取數服務已就緒，畫面保留已取得的快照；沒有額外查詢市場資料。' : '取數服務已就緒。尚未查詢市場資料，按鈕才會送出一次請求。') : explain(result.error_class || 'preview_disabled'));
    } catch (_) { badge.textContent = '尚未連線'; display('warning','無法連線本機取數服務，請確認啟動器仍在執行。'); }
    finally { sync(); }
  }
  button.addEventListener('click',async () => {
    if (!ready || busy) return;
    busy = true; sync(); display('loading','正在取得這一份 BQL 快照，最多等待 270 秒。不會自動重試。');
    try {
      const result = await request('/preview');
      if (!result.ok) throw new Error(explain(result.error_class));
      if (result.validation !== 'schema_only' || result.comparison !== 'not_verified') throw new Error('回傳的預覽狀態無效。');
      const bonds = window.LuacModel.validateSnapshot(result.data);
      document.getElementById('explorer').hidden = false;
      window.BqlExplorer.load(result.data);
      document.getElementById('lab-empty').hidden = true;
      document.getElementById('lab-date').textContent = result.data.date.replaceAll('-','/');
      document.getElementById('lab-count').textContent = bonds.length.toLocaleString('en-US');
      document.getElementById('lab-anomalies').textContent = bonds.filter(bond => bond.flags.length).length.toLocaleString('en-US');
      document.getElementById('lab-fetched').textContent = new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
      hasSnapshot = true;
      display('success',`已載入 ${bonds.length.toLocaleString('en-US')} 筆 API 測試資料。查詢已結束，沒有背景更新；尚未取得正式比對核准。`);
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? '本頁等待逾時，沒有重試。' : error.message;
      display('warning',`${reason}${hasSnapshot ? ' 畫面保留上一份快照；摘要日期未變更。' : ' 尚未載入任何資料。'}`);
    } finally { busy = false; sync(); }
  });
  check.addEventListener('click',connection);
  connection(); // Environment metadata only. No automatic market query.
})();
