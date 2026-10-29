(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('api-update'))return;
  const state={current:null,candidate:null,config:null,ready:false,qualified:false,busy:false,epoch:0,token:null,session:null,published:false};
  const text=(id,kind,message)=>{const element=$(id);element.className=`api-status ${kind}`;element.textContent=message;};
  function tokenFromPage(){return new URLSearchParams(location.hash.slice(1)).get('bbg-token');}
  function sync(){
    $('api-fetch').disabled=!(state.current&&state.ready&&!state.busy);
    $('api-check').disabled=state.busy;
    $('api-published').disabled=state.busy||!state.current;
    $('api-publish').disabled=!(state.candidate&&state.qualified&&state.config?.luac_enabled&&$('api-confirm').checked&&!state.busy&&!state.published);
    $('api-confirm').disabled=state.busy;
    $('api-password').disabled=state.busy||!state.config?.luac_enabled;
    $('api-fetch').textContent=state.busy?'處理中，請稍候…':'取得最新 API 快照';
    $('api-qualification').href=state.token?`update.html#bbg-token=${encodeURIComponent(state.token)}`:'update.html';
  }
  async function bridge(path){
    const response=await fetch(`http://127.0.0.1:8768${path}`,{
      method:path==='/health'?'GET':'POST',cache:'no-store',
      headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},
      ...(path==='/health'?{}:{body:'{}'}),
      signal:AbortSignal.timeout(path==='/health'?20000:280000),
    });
    const body=await response.json();
    if(!response.ok)throw Error(body.error==='unauthorized'?'連線憑證已失效，請執行 Reset.cmd 並使用新開啟的網頁。':`本機服務 HTTP ${response.status}`);
    return body;
  }
  async function connect(){
    if(state.busy)return;
    state.ready=false;state.qualified=false;state.token=tokenFromPage();sync();
    $('api-connection').classList.remove('connected');
    if(!state.token){
      $('api-connection').textContent='尚未連線';
      text('api-status','neutral','請登入 Bloomberg 並執行 Start.cmd，使用它開啟的單券頁。下方先顯示已發布快照。');
      return;
    }
    const epoch=state.epoch;
    try{
      const result=await bridge('/health');
      if(epoch!==state.epoch)return;
      state.ready=result.ready===true&&result.preview_enabled===true;state.qualified=result.api_qualified===true;
      $('api-connection').textContent=state.ready?'本機服務就緒':'本機環境未就緒';
      $('api-connection').classList.toggle('connected',state.ready);
      $('api-qualification-status').textContent=state.qualified?'這台電腦已完成目前取數版本的一次性 Excel 比對，可直接以 API 更新。':'尚未完成目前取數版本的一次性 Excel 比對。請展開設定並前往比對；未通過前只能查看 API，無法正式發布。';
      $('api-setup').open=!state.qualified;
      text('api-status',state.ready?'neutral':'error',state.ready?(state.qualified?'已連線。按取數才會查詢一次行情；取得後可核對並發布。':'已連線，可先取數查看。正式發布前請完成一次性 Excel 比對。'):'環境未就緒，請確認 Bloomberg 已登入；連線問題用 Reset.cmd，缺少套件用 Repair.cmd。');
    }catch(error){$('api-connection').textContent='連線失敗';text('api-status','error',`${error.message||'無法連線'} 請確認啟動器視窗仍開啟。`);}
    finally{sync();}
  }
  function show(data,source){
    window.LuacExplorer.load(data);
    const time=document.querySelector('.bond-date time');time.dateTime=data.date;time.textContent=data.date.replaceAll('-','/');
    $('bond-source').textContent=source;
  }
  async function fetchSnapshot(){
    if(!state.ready||state.busy||!state.current)return;
    state.busy=true;state.candidate=null;state.published=false;$('api-confirm').checked=false;sync();
    const epoch=state.epoch;
    text('api-status','neutral','正在查詢一次完整 BQL 快照，最多等待 280 秒。失敗不會自動重試。');
    text('api-publish-status','neutral','等待本次快照；先前快照的發布確認已清除。');
    try{
      const result=await bridge('/preview');
      if(epoch!==state.epoch)throw Error('連線已變更，本次回應未套用。');
      if(!result.ok)throw Error(({query_timeout:'查詢逾時',not_authorized:'Bloomberg 帳號缺少資料權限',market_date_unverified:'行情日期無法確認',mixed_market_dates:'行情日期不一致',probe_busy:'另一個查詢正在執行'})[result.error_class]||`API 取數失敗：${result.error_class||'未知錯誤'}`);
      if(result.validation!=='schema_only'||result.comparison!=='not_verified')throw Error('API 快照狀態不正確。');
      const data=result.data,bonds=window.LuacModel.validateSnapshot(data);
      if(data.date<state.current.date)throw Error(`API 日期 ${data.date} 早於已發布日期 ${state.current.date}。`);
      const ratio=bonds.length/state.current.records.length;
      if(ratio<.8||ratio>1.2)throw Error('單券筆數變動超過 ±20%，需人工核對。');
      if(JSON.stringify(data.peer_definitions)!==JSON.stringify(state.current.peer_definitions))throw Error('Peer Group mapping 已變更，請執行 Reset.cmd 後重新取數。');
      if(new TextEncoder().encode(JSON.stringify(data)).length>4*1024*1024)throw Error('快照超過 4 MiB 上限。');
      show(data,'API 快照，尚未發布');
      state.candidate=data;state.qualified=result.api_qualified===true;
      $('api-summary').hidden=false;$('api-publish-form').hidden=false;
      $('api-date').textContent=data.date;$('api-count').textContent=bonds.length.toLocaleString('en-US');
      $('api-anomalies').textContent=bonds.filter(bond=>bond.flags.length).length.toLocaleString('en-US');
      $('api-snapshot-state').textContent='尚未發布';
      text('api-status','success',`已取得 ${bonds.length.toLocaleString('en-US')} 筆 API 快照。下方圖表已更新；正式站資料尚未變更。`);
      text('api-publish-status',state.qualified?'neutral':'error',state.qualified?(state.config?.luac_enabled?'核對日期與筆數、勾選確認並輸入上傳密碼後，即可發布。':'正式發布服務尚未啟用。'):'請先完成一次性 Excel 比對，再重新取數。');
    }catch(error){text('api-status','error',`${error.name==='TimeoutError'?'查詢等待逾時，沒有重試。':error.message} 畫面保留先前資料及日期；本次無可發布快照。`);}
    finally{state.busy=false;sync();}
  }
  async function api(path,options={}){
    const response=await fetch(`${state.config.api_url.replace(/\/$/,'')}${path}`,{
      ...options,signal:AbortSignal.timeout(45000),cache:'no-store',
      headers:{'Content-Type':'application/json',...(state.session?{Authorization:`Bearer ${state.session}`}:{})},
    });
    const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;
  }
  async function publish(){
    if($('api-publish').disabled)return;
    const password=$('api-password').value;
    if(!password){text('api-publish-status','error','請輸入上傳密碼。');return;}
    const candidate=state.candidate;
    state.busy=true;sync();text('api-publish-status','neutral','正在登入並建立單券更新 PR…');
    try{
      const gate=await bridge('/health');
      if(gate.api_qualified!==true||gate.ready!==true||state.candidate!==candidate)throw Error('本機比對資格或連線已變更，請檢查連線並重新取數。');
      const session=await api('/session',{method:'POST',body:JSON.stringify({password})});
      state.session=session.token;$('api-password').value='';
      let job;
      // The Worker deduplicates sanitized snapshots. Retry only transport loss,
      // never a market query and never a rejected publication.
      for(let attempt=0;attempt<3;attempt++){
        try{job=await api('/publish/luac',{method:'POST',body:JSON.stringify({data:candidate})});break;}
        catch(error){if(!(error instanceof TypeError)||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}
      }
      if(!job?.id)throw Error('發布服務未回傳更新編號。');
      for(let attempt=0;attempt<60;attempt++){
        const result=await api(`/status/luac/${encodeURIComponent(job.id)}`);
        text('api-publish-status',result.state==='failed'?'error':result.state==='deployed'?'success':'neutral',result.message||'正在處理更新…');
        if(result.state==='failed')throw Error(result.message||'正式發布未完成。');
        if(result.state==='deployed'){
          state.current=candidate;state.published=true;
          $('api-snapshot-state').textContent='已發布';$('bond-source').textContent='已發布 API 快照，非即時行情';
          text('api-status','success','API 資料已發布完成。之後開啟單券頁會讀取這份正式快照。');return;
        }
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
      throw Error('等待超過 10 分鐘，請稍後查看正式資料；不要重新查詢行情。');
    }catch(error){text('api-publish-status','error',`${error.message} 若 PR 已建立，後續送出相同快照會查回原更新。`);}
    finally{state.busy=false;state.session=null;sync();}
  }
  $('api-fetch').addEventListener('click',fetchSnapshot);
  $('api-check').addEventListener('click',connect);
  $('api-confirm').addEventListener('change',sync);
  $('api-publish-form').addEventListener('submit',event=>{event.preventDefault();publish();});
  $('api-published').addEventListener('click',()=>{
    if(state.busy||!state.current)return;
    state.candidate=null;state.published=false;$('api-confirm').checked=false;
    $('api-summary').hidden=true;$('api-publish-form').hidden=true;
    show(state.current,'已發布快照，非即時行情');
    text('api-status','neutral','已切回正式快照；尚未發布的 API 資料已清除。');sync();
  });
  window.addEventListener('hashchange',()=>{
    state.epoch++;state.candidate=null;state.qualified=false;$('api-confirm').checked=false;sync();
    if(!state.busy)connect();
  });
  Promise.all([window.LuacExplorer.ready,fetch('assets/upload-config.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('無法讀取更新服務設定');return response.json();})]).then(([current,config])=>{
    if(!current)throw Error('無法讀取已發布單券快照，暫停 API 更新。');
    if(config.api_url!=='https://rv-upload-service.rv-dashboard.workers.dev')throw Error('更新服務網址不正確。');
    state.current=current;state.config=config;sync();connect();
  }).catch(error=>text('api-status','error',error.message));
})();
