(() => {
  'use strict';

  const METRICS=['Spread','10Y','30Y','10s30s'];
  const FIELDS=['min','median','max','current','pct'];
  const SECTIONS={
    Overview:['JULI','Fin','Non-Fin','AA','A','BBB'],
    Cyclical:['US Bank','Yankee Bank','Insurance','M&M','Chemical','Tech','Auto','Media','Energy','Capital Good'],
    'Non-Cyclical':['Telecom','Utility','F&B','Tobacco','Healthcare','Retail','Transportation']
  };
  const ALIASES={Ins:'Insurance',Chem:'Chemical',HC:'Healthcare',Trans:'Transportation'};
  const LUAC_HEADERS=['ID','SECURITY_DES','LONG_COMP_NAME','TICKER','MATURITY','BB_COMPOSITE','MTY_YEARS_TDY','DATES',"SPREAD(ST='OAS',PRICING_SOURCE=BVAL,SIDE=BID)",'YIELD(YT=CONVENTION,PRICING_SOURCE=BVAL,SIDE=BID)','CLASSIFICATION_NAME(BICS,1,TYPE=ISSUER)'];
  const SUPPLY_REQUIRED=['BB ID','CUSIP','Ticker','Corp Ticker','Pricing Date','Tranche Size','Tenor','Ind Sector','BB Composite'];
  const inputs=new Map([...document.querySelectorAll('input[type=file][data-metric]')].map(input=>[input.dataset.metric,input]));
  const names=new Map([...document.querySelectorAll('[data-file-name]')].map(output=>[output.dataset.fileName,output]));
  const validationStatus=document.querySelector('#validation-status');
  const validationSummary=document.querySelector('#validation-summary');
  const publishStatus=document.querySelector('#publish-status');
  const publishButton=document.querySelector('#publish-data');
  const password=document.querySelector('#upload-password');
  const serviceState=document.querySelector('#service-state');
  const drop=document.querySelector('#bulk-drop');
  const luacFile=document.querySelector('#luac-file'),luacFileName=document.querySelector('#luac-file-name');
  const luacValidationStatus=document.querySelector('#luac-validation-status'),luacValidationSummary=document.querySelector('#luac-validation-summary');
  const luacPublishStatus=document.querySelector('#luac-publish-status'),luacPublishButton=document.querySelector('#publish-luac'),luacPassword=document.querySelector('#luac-upload-password');
  const bqlConfirmWrap=document.querySelector('#bql-confirm-wrap'),bqlConfirm=document.querySelector('#bql-confirm');
  const bloombergPanel=document.querySelector('#bloomberg-diagnostic'),bloombergButton=document.querySelector('#probe-bloomberg'),bloombergStatus=document.querySelector('#bloomberg-status'),bloombergSummary=document.querySelector('#bloomberg-summary');
  const supplyFile=document.querySelector('#supply-file'),supplyFileName=document.querySelector('#supply-file-name');
  const peerFile=document.querySelector('#peer-group-file'),peerFileName=document.querySelector('#peer-group-file-name');
  const supplyValidationStatus=document.querySelector('#supply-validation-status'),supplyValidationSummary=document.querySelector('#supply-validation-summary'),supplyPublishStatus=document.querySelector('#supply-publish-status'),supplyPublishButton=document.querySelector('#publish-supply'),supplyPassword=document.querySelector('#supply-upload-password');
  const bridgeToken=new URLSearchParams(location.hash.slice(1)).get('bbg-token');
  const state={files:{},data:null,luacData:null,luacSourceMode:null,luacPublishEligible:false,supplyData:null,supplyPublishEligible:false,bridgeReady:false,config:{enabled:false,luac_enabled:false,supply_enabled:false,api_url:''},currentDate:null,currentLuacDate:null,currentLuacCount:null,currentLuacPeers:null,currentSupply:null,token:null};

  const setStatus=(element,type,message)=>{element.className=`status ${type}`;element.textContent=message;};
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const column=number=>{let out='';while(number){number--;out=String.fromCharCode(65+number%26)+out;number=Math.floor(number/26);}return out;};
  const child=(node,name)=>[...node.childNodes].find(item=>item.localName===name);
  const nodes=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
  const xml=(bytes,path)=>{
    if(!bytes)throw Error(`Excel 缺少必要檔案：${path}`);
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
    if(doc.querySelector('parsererror'))throw Error(`Excel XML 無法解析：${path}`);
    return doc;
  };
  const dateFromSerial=(serial,date1904)=>{
    if(!finite(serial))throw Error('Excel 資料日期不是有效數字');
    const epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30);
    return new Date(epoch+Math.floor(serial)*86400000).toISOString().slice(0,10);
  };
  async function inflate(bytes,method){
    if(method===0)return bytes;
    if(method!==8)throw Error(`不支援的 Excel ZIP 壓縮格式：${method}`);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(file){
    if(file.size>50*1024*1024)throw Error(`${file.name} 超過 50 MB 上限`);
    const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)throw Error('檔案不是有效的 .xlsx ZIP');
    const count=view.getUint16(end+10,true),decoder=new TextDecoder(),entries=new Map();
    let offset=view.getUint32(end+16,true);
    for(let i=0;i<count;i++){
      if(view.getUint32(offset,true)!==0x02014b50)throw Error('Excel ZIP 目錄損壞');
      const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
      const name=decoder.decode(bytes.slice(offset+46,offset+46+nameLength));
      const localNameLength=view.getUint16(local+26,true),localExtraLength=view.getUint16(local+28,true),start=local+30+localNameLength+localExtraLength;
      if(/^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/)|\[Content_Types\])/.test(name))entries.set(name,await inflate(bytes.slice(start,start+size),method));
      offset+=46+nameLength+extraLength+commentLength;
    }
    return entries;
  }
  function workbookSheets(entries){
    const workbook=xml(entries.get('xl/workbook.xml'),'xl/workbook.xml');
    const rels=xml(entries.get('xl/_rels/workbook.xml.rels'),'xl/_rels/workbook.xml.rels');
    const targets=new Map(nodes(rels,'Relationship').map(rel=>[rel.getAttribute('Id'),rel.getAttribute('Target')]));
    const sheets=new Map();
    for(const sheet of nodes(workbook,'sheet')){
      const rid=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id');
      let target=targets.get(rid)||'';
      target=target.replace(/^\//,'');
      if(!target.startsWith('xl/'))target=`xl/${target}`;
      sheets.set(sheet.getAttribute('name'),target.replace('/./','/'));
    }
    const workbookPr=nodes(workbook,'workbookPr')[0];
    return {sheets,date1904:workbookPr?.getAttribute('date1904')==='1'||workbookPr?.getAttribute('date1904')==='true'};
  }
  function sharedStrings(entries){
    const bytes=entries.get('xl/sharedStrings.xml');
    if(!bytes)return [];
    return nodes(xml(bytes,'xl/sharedStrings.xml'),'si').map(si=>nodes(si,'t').map(t=>t.textContent||'').join(''));
  }
  function cells(doc,strings){
    const map=new Map();
    for(const cell of nodes(doc,'c')){
      const address=cell.getAttribute('r'),type=cell.getAttribute('t')||'n',valueNode=child(cell,'v');
      let value=null;
      if(type==='s'&&valueNode)value=strings[Number(valueNode.textContent)];
      else if(type==='inlineStr')value=nodes(cell,'t').map(t=>t.textContent||'').join('');
      else if(type==='str'&&valueNode)value=valueNode.textContent;
      else if(type!=='e'&&valueNode&&valueNode.textContent!=='')value=Number(valueNode.textContent);
      map.set(address,value);
    }
    return map;
  }
  async function parseWorkbook(file,metric){
    if(!file||!file.name.toLowerCase().endsWith('.xlsx'))throw Error(`${metric} 必須選取 .xlsx 檔案`);
    const entries=await unzip(file),strings=sharedStrings(entries),{sheets,date1904}=workbookSheets(entries),dates=[],result={};
    for(const [section,categories] of Object.entries(SECTIONS)){
      const summaryPath=sheets.get(section),historyPath=sheets.get(`${section} data`);
      if(!summaryPath||!historyPath)throw Error(`${metric} 缺少 ${section} 或 ${section} data 工作表`);
      const summary=cells(xml(entries.get(summaryPath),summaryPath),strings),history=cells(xml(entries.get(historyPath),historyPath),strings);
      const records=[];
      for(let index=0;index<categories.length;index++){
        const expected=categories[index],actual=summary.get(`${column(5+index)}4`),normalized=ALIASES[actual]||actual;
        if(normalized!==expected)throw Error(`${metric}／${section} 分類不符：預期 ${expected}，讀到 ${actual??'空白'}`);
        dates.push({metric,section,sector:expected,date:dateFromSerial(history.get(`${column(1+index*4)}8`),date1904)});
        const record={sector:expected,sources:{}};
        for(let fieldIndex=0;fieldIndex<FIELDS.length;fieldIndex++){
          const field=FIELDS[fieldIndex],row=[5,7,9,11,6][fieldIndex],base=field==='pct'?[16,18,17][Object.keys(SECTIONS).indexOf(section)]:5;
          const address=`${column(base+index)}${row}`,value=summary.get(address);
          if(!finite(value))throw Error(`${metric}／${section}／${expected} 的 ${field}（${address}）缺值或不是有效數字`);
          if(field==='pct'&&(value<0||value>1))throw Error(`${metric}／${section}／${expected} 的 percentile 超出 0–100%`);
          record[field]=value;record.sources[field]='Excel';
        }
        if(!(record.min<=record.median&&record.median<=record.max))throw Error(`${metric}／${section}／${expected} 未符合 Min ≤ Median ≤ Max`);
        records.push(record);
      }
      result[section]=records;
    }
    return {metric,dates,result};
  }
  const present=value=>value!==null&&value!==undefined&&value!=='';
  const luacText=(value,field,row,maximum=Infinity)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>maximum)throw Error(`LUAC 第 ${row} 列的 ${field} 無效`);return value.trim();};
  const luacNumber=(value,field,row)=>{if(!finite(value))throw Error(`LUAC 第 ${row} 列的 ${field} 無效`);return value;};
  const luacFlags=(years,oas,bondYield)=>{
    const flags=[];
    if(bondYield<=0||bondYield>50)flags.push('yield_outlier');
    if(years<=0||years>100)flags.push('maturity_outlier');
    if(oas<-250||oas>5000)flags.push('oas_outlier');
    return flags;
  };
  async function parseLuacWorkbook(file,peerDefinitions){
    if(!file||!file.name.toLowerCase().endsWith('.xlsx'))throw Error('LUAC 必須選取 .xlsx 檔案');
    const entries=await unzip(file),strings=sharedStrings(entries),book=workbookSheets(entries);
    if(book.sheets.size!==1)throw Error('LUAC Excel 必須且只能有一個工作表');
    const path=[...book.sheets.values()][0],doc=xml(entries.get(path),path);
    const formulas=nodes(doc,'f');let sourceMode='values';
    if(formulas.length){
      const formula=formulas[0],cached=child(formula.parentElement,'v');
      if(formulas.length!==1||!/^\s*(?:_xll\.)?BQL\s*\(/i.test(formula.textContent||''))throw Error('LUAC Excel 只允許一個 BQL 公式；其他公式一律拒絕');
      if(!cached||cached.textContent==='')throw Error('BQL 公式沒有已儲存的快取值；請等待更新完成並儲存 Excel');
      sourceMode='bql_cache';
    }
    const values=cells(doc,strings),headers=LUAC_HEADERS.map((_,index)=>values.get(`${column(index+1)}1`));
    if(JSON.stringify(headers)!==JSON.stringify(LUAC_HEADERS))throw Error('LUAC Excel 欄位不符合必要格式');
    const maximum=[...values.keys()].reduce((highest,address)=>Math.max(highest,Number(/\d+$/.exec(address)?.[0]||0)),1),staticRows=new Map(),marketRows=new Map(),order=[];
    for(let row=2;row<=maximum;row++){
      const record=LUAC_HEADERS.map((_,index)=>values.get(`${column(index+1)}${row}`)??null);
      if(record.every(value=>!present(value)))continue;
      const id=luacText(record[0],'ID',row,64),hasStatic=[1,2,3,4,5,6,10].some(index=>present(record[index])),hasMarket=[7,8,9].some(index=>present(record[index]));
      if(hasStatic===hasMarket)throw Error(`LUAC 第 ${row} 列必須只屬於靜態或行情區塊`);
      const target=hasStatic?staticRows:marketRows;
      if(target.has(id))throw Error(`LUAC ID 重複：${id}`);
      if(hasStatic){
        for(const [index,field,maximum] of [[1,'SECURITY_DES',180],[2,'發行人',300],[3,'Ticker',32],[5,'信評',16],[10,'產業',160]])luacText(record[index],field,row,maximum);
        luacNumber(record[4],'到期日',row);luacNumber(record[6],'剩餘年期',row);order.push(id);
      }else{
        luacNumber(record[7],'資料日期',row);luacNumber(record[8],'OAS',row);luacNumber(record[9],'Yield',row);
      }
      target.set(id,record);
    }
    if(!staticRows.size||staticRows.size!==marketRows.size||[...staticRows.keys()].some(id=>!marketRows.has(id)))throw Error('LUAC 靜態與行情區塊的 ID 必須完整一致');
    const dates=new Set([...marketRows.values()].map(record=>dateFromSerial(record[7],book.date1904)));
    if(dates.size!==1)throw Error('LUAC 行情資料日期不一致');
    const records=order.map(id=>{
      const source=staticRows.get(id),market=marketRows.get(id),years=luacNumber(source[6],'剩餘年期',0),oas=luacNumber(market[8],'OAS',0),bondYield=luacNumber(market[9],'Yield',0);
      return [id,luacText(source[1],'SECURITY_DES',0,180),luacText(source[2],'發行人',0,300),luacText(source[3],'Ticker',0,32),dateFromSerial(source[4],book.date1904),luacText(source[5],'信評',0,16),years,oas,bondYield,luacText(source[10],'產業',0,160),luacFlags(years,oas,bondYield)];
    });
    if(records.length<1||records.length>20000)throw Error(`LUAC 債券筆數 ${records.length} 超出允許範圍`);
    const data={schema_version:window.LuacModel.SCHEMA_VERSION,date:[...dates][0],columns:window.LuacModel.COLUMNS,peer_definitions:peerDefinitions,records};
    window.LuacModel.validateSnapshot(data);
    if(new TextEncoder().encode(JSON.stringify({data})).byteLength>4*1024*1024)throw Error('LUAC 公開資料超過 4 MiB 上限');
    return {data,sourceMode};
  }
  async function tableFromWorkbook(file,required,label){
    if(!file||!file.name.toLowerCase().endsWith('.xlsx'))throw Error(`${label} 必須選取 .xlsx 檔案`);
    const entries=await unzip(file),strings=sharedStrings(entries),book=workbookSheets(entries),matches=[];
    for(const [name,path] of book.sheets){
      const doc=xml(entries.get(path),path),values=cells(doc,strings),headers={};
      for(let index=1;index<=256;index++){const value=values.get(`${column(index)}1`);if(typeof value==='string'&&!(value.trim() in headers))headers[value.trim()]=index;}
      if(required.every(header=>header in headers))matches.push({name,doc,values,headers});
    }
    if(matches.length!==1)throw Error(`${label} 必須且只能有一個工作表含有：${required.join('、')}`);
    return matches[0];
  }
  const supplyText=(value,field,row,maximum=160)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>maximum)throw Error(`Supply 第 ${row} 列的 ${field} 無效`);return value.trim();};
  const supplyUsd=(value,row)=>{if(!finite(value)||value<=0||!Number.isSafeInteger(value)||value>1e13)throw Error(`Supply 第 ${row} 列的 Tranche Size 無效`);return value;};
  function supplyDate(value,row){
    if(finite(value))return dateFromSerial(value,false);
    if(typeof value==='string'){
      let match=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
      if(match){let year=Number(match[3]);if(year<100)year+=year>=70?1900:2000;const result=`${String(year).padStart(4,'0')}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;if(!Number.isNaN(Date.parse(`${result}T00:00:00Z`)))return result;}
      if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`)))return value;
    }
    throw Error(`Supply 第 ${row} 列的 Pricing Date 無效`);
  }
  function supplyTenor(security,tenor,row){const upper=security.toUpperCase();if(upper.includes('FLOAT')||/\bFRN\b/.test(upper))return 'FRN';if(upper.includes('PERP'))return 'Perpetual';if(!finite(tenor)||tenor<=0)throw Error(`Supply 第 ${row} 列的 Tenor 無效`);if(tenor<=3.5)return '3yr & In (1.5–3.5yr)';if(tenor<=6)return '5yr (3.5–6yr)';if(tenor<=8)return '7yr (6–8yr)';if(tenor<=12)return '10yr (8–12yr)';if(tenor<=22)return '20yr (12–22yr)';if(tenor<=32)return '30yr (22–32yr)';return '>32yr (>32yr)';}
  const supplyRating=value=>{const normalized=typeof value==='string'?value.trim().toUpperCase():'';return window.SupplyModel.RATING_ORDER.includes(normalized)?normalized:'NR';};
  async function parsePeerDefinitions(file,fallback){
    if(!file)return structuredClone(fallback||[]);
    const table=await tableFromWorkbook(file,['TICKER','Peer Group'],'Peer Group Excel'),maximum=[...table.values.keys()].reduce((value,address)=>Math.max(value,Number(/\d+$/.exec(address)?.[0]||0)),1),definitions=[],byName=new Map(),seen=new Set(),formulaAddresses=new Set(nodes(table.doc,'f').map(item=>item.parentElement?.getAttribute('r')));
    for(let row=2;row<=maximum;row++){
      const tickerValue=table.values.get(`${column(table.headers.TICKER)}${row}`),groupValue=table.values.get(`${column(table.headers['Peer Group'])}${row}`);
      if(!present(tickerValue)&&!present(groupValue))continue;
      if(formulaAddresses.has(`${column(table.headers.TICKER)}${row}`)||formulaAddresses.has(`${column(table.headers['Peer Group'])}${row}`))throw Error(`Peer Group 第 ${row} 列不可使用公式`);
      const ticker=supplyText(tickerValue,'TICKER',row,32).toUpperCase(),name=supplyText(groupValue,'Peer Group',row);
      if(seen.has(ticker))throw Error(`Peer Group ticker 重複：${ticker}`);seen.add(ticker);
      if(!byName.has(name)){const definition={name,tickers:[]};byName.set(name,definition);definitions.push(definition);}byName.get(name).tickers.push(ticker);
    }
    if(!definitions.length)throw Error('Peer Group mapping 為空');return definitions;
  }
  const supplyPairs=(totals,order=null)=>{const names=order||[...totals.keys()].sort((a,b)=>totals.get(b)-totals.get(a)||a.localeCompare(b));return names.map(name=>[name,totals.get(name)||0]);};
  const supplyTop=totals=>supplyPairs(totals).slice(0,5);
  async function parseSupplyWorkbook(file){
    const [table,definitions]=await Promise.all([tableFromWorkbook(file,SUPPLY_REQUIRED,'Supply Excel'),parsePeerDefinitions(peerFile.files[0]||null,state.currentSupply?.peer_definitions)]);
    if(!definitions.length)throw Error('正式站與上傳檔都沒有 Peer Group mapping');
    const maximum=[...table.values.keys()].reduce((value,address)=>Math.max(value,Number(/\d+$/.exec(address)?.[0]||0)),1),formulaAddresses=new Set(nodes(table.doc,'f').map(item=>item.parentElement?.getAttribute('r'))),records=[],requiredColumns=SUPPLY_REQUIRED.map(field=>table.headers[field]);
    for(let row=2;row<=maximum;row++){
      const value=field=>table.values.get(`${column(table.headers[field])}${row}`);
      if(!present(value('BB ID')))continue;
      if(requiredColumns.some(index=>formulaAddresses.has(`${column(index)}${row}`)))throw Error(`Supply 第 ${row} 列必填欄位不可使用公式`);
      records.push({row,id:supplyText(value('BB ID'),'BB ID',row,64),cusip:supplyText(value('CUSIP'),'CUSIP',row,32),security:supplyText(value('Ticker'),'Ticker',row,180),ticker:supplyText(value('Corp Ticker'),'Corp Ticker',row,32).toUpperCase(),date:supplyDate(value('Pricing Date'),row),usd:supplyUsd(value('Tranche Size'),row),tenor:value('Tenor'),industry:supplyText(value('Ind Sector'),'Ind Sector',row),rating:supplyRating(value('BB Composite'))});
    }
    if(!records.length)throw Error('Supply Excel 沒有發行記錄');
    const yearCounts=new Map();for(const record of records){const year=Number(record.date.slice(0,4));yearCounts.set(year,(yearCounts.get(year)||0)+1);}const ranked=[...yearCounts].sort((a,b)=>b[1]-a[1]);if(ranked.length>1&&ranked[0][1]===ranked[1][1])throw Error('Supply Excel 無法判定主年份');const year=ranked[0][0],validRows=records.filter(record=>Number(record.date.slice(0,4))===year);let corrections=0;
    for(const record of records){if(Number(record.date.slice(0,4))===year)continue;const candidates=validRows.filter(candidate=>candidate.ticker===record.ticker).map(candidate=>[Math.abs(candidate.row-record.row),candidate]).sort((a,b)=>a[0]-b[0]||a[1].row-b[1].row);if(!candidates.length)throw Error(`Supply 第 ${record.row} 列沒有同 ticker ${year} 日期候選`);if(candidates.length>1&&candidates[0][0]===candidates[1][0])throw Error(`Supply 第 ${record.row} 列的同 ticker 日期候選距離相同`);record.date=candidates[0][1].date;corrections++;}
    const peerNames=definitions.map(item=>item.name),allPeers=[...peerNames,'Other IG'],peerLookup=new Map(definitions.flatMap(item=>item.tickers.map(ticker=>[ticker,item.name]))),industry=new Map(),rating=new Map(),tenor=new Map(),peer=new Map(),peerTickers=Object.fromEntries(peerNames.map(name=>[name,new Map()])),industryTickers=new Map(),ratingTickers=new Map(),peerTopTickers=new Map(),monthlyTotal=Array(12).fill(0),monthlyPeer=Object.fromEntries(allPeers.map(name=>[name,Array(12).fill(0)])),monthlyTotalTickers=Array.from({length:12},()=>new Map()),monthlyPeerTickers=Object.fromEntries(allPeers.map(name=>[name,Array.from({length:12},()=>new Map())])),add=(map,key,value)=>map.set(key,(map.get(key)||0)+value),addNested=(outer,key,ticker,value)=>{if(!outer.has(key))outer.set(key,new Map());add(outer.get(key),ticker,value);};
    for(const record of records){const group=peerLookup.get(record.ticker)||'Other IG',bucket=supplyTenor(record.security,record.tenor,record.row),month=Number(record.date.slice(5,7))-1;add(industry,record.industry,record.usd);add(rating,record.rating,record.usd);add(tenor,bucket,record.usd);add(peer,group,record.usd);monthlyTotal[month]+=record.usd;monthlyPeer[group][month]+=record.usd;addNested(industryTickers,record.industry,record.ticker,record.usd);addNested(ratingTickers,record.rating,record.ticker,record.usd);addNested(peerTopTickers,group,record.ticker,record.usd);add(monthlyTotalTickers[month],record.ticker,record.usd);add(monthlyPeerTickers[group][month],record.ticker,record.usd);if(group!=='Other IG')add(peerTickers[group],record.ticker,record.usd);}
    const dates=records.map(record=>record.date).sort(),date=dates.at(-1),ytd=records.reduce((sum,record)=>sum+record.usd,0),month=date.slice(5,7),mtd=records.filter(record=>record.date.slice(5,7)===month).reduce((sum,record)=>sum+record.usd,0),ratingOrder=[...window.SupplyModel.RATING_ORDER.filter(value=>rating.has(value)),...[...rating.keys()].filter(value=>!window.SupplyModel.RATING_ORDER.includes(value)).sort()],cusips=new Map();for(const record of records)cusips.set(record.cusip,(cusips.get(record.cusip)||0)+1);
    const industryPairs=supplyPairs(industry),ratingPairs=supplyPairs(rating,ratingOrder);const data={schema_version:window.SupplyModel.SCHEMA_VERSION,date,year,currency:'USD',row_count:records.length,ytd_usd:ytd,mtd_usd:mtd,breakdowns:{industry:industryPairs,rating:ratingPairs,tenor:supplyPairs(tenor,window.SupplyModel.TENOR_BUCKETS),peer_group:supplyPairs(peer,allPeers)},monthly:{total:monthlyTotal,peer_groups:allPeers.map(name=>[name,monthlyPeer[name]])},peer_definitions:definitions,peer_tickers:Object.fromEntries(peerNames.map(name=>[name,supplyPairs(peerTickers[name])])),top_tickers:{ytd:{industry:industryPairs.map(([name])=>[name,supplyTop(industryTickers.get(name)||new Map())]),rating:ratingPairs.map(([name])=>[name,supplyTop(ratingTickers.get(name)||new Map())]),peer_group:allPeers.map(name=>[name,supplyTop(peerTopTickers.get(name)||new Map())])},monthly:{total:monthlyTotalTickers.map(supplyTop),peer_groups:allPeers.map(name=>[name,monthlyPeerTickers[name].map(supplyTop)])}},quality:{date_corrections:corrections,duplicate_cusip_groups:[...cusips.values()].filter(count=>count>1).length}};
    window.SupplyModel.validateSnapshot(data);return data;
  }
  function validateSnapshot(data){
    if(data.horizon!=='2Y'||Object.keys(data.sections).join('|')!==Object.keys(SECTIONS).join('|'))throw Error('公開資料結構不正確');
    let count=0;
    for(const [section,categories] of Object.entries(SECTIONS))for(const metric of METRICS){
      const records=data.sections[section][metric];
      if(!Array.isArray(records)||records.length!==categories.length)throw Error(`${section}／${metric} 分類數量不正確`);
      records.forEach((record,index)=>{
        if(record.sector!==categories[index])throw Error(`${section}／${metric} 分類順序不正確`);
        for(const field of FIELDS){
          if(!finite(record[field]))throw Error(`${section}／${metric}／${record.sector} 的 ${field} 無效`);
          if(field==='pct'&&(record[field]<0||record[field]>1))throw Error(`${section}／${metric}／${record.sector} 的 percentile 超出 0–100%`);
          if(record.sources?.[field]!=='Excel')throw Error('自動更新只接受 Excel 來源');
          count++;
        }
        if(!(record.min<=record.median&&record.median<=record.max))throw Error(`${section}／${metric}／${record.sector} 未符合 Min ≤ Median ≤ Max`);
      });
    }
    if(count!==460)throw Error(`應有 460 個值，實際為 ${count}`);
    return count;
  }
  function classify(name){
    const lower=name.toLowerCase().replace(/\s+/g,'');
    if(lower.includes('10s30s'))return '10s30s';
    if(lower.includes('30y'))return '30Y';
    if(lower.includes('10y'))return '10Y';
    if(lower.includes('percentile')||lower.includes('spread')||lower.includes('2y'))return 'Spread';
    return null;
  }
  function choose(metric,file){state.files[metric]=file;names.get(metric).textContent=file.name;state.data=null;validationSummary.hidden=true;publishButton.disabled=true;setStatus(validationStatus,'neutral','檔案已變更，請重新驗證。');}
  function assign(files){
    const unknown=[],duplicates=[];
    for(const file of files){const metric=classify(file.name);if(!metric)unknown.push(file.name);else if(state.files[metric])duplicates.push(metric);else choose(metric,file);}
    if(unknown.length||duplicates.length)setStatus(validationStatus,'error',[unknown.length?`無法辨識：${unknown.join('、')}`:'',duplicates.length?`重複指標：${[...new Set(duplicates)].join('、')}`:''].filter(Boolean).join('\n'));
  }
  function clear(){state.files={};state.data=null;state.token=null;for(const input of inputs.values())input.value='';for(const output of names.values())output.textContent='尚未選取';validationSummary.hidden=true;publishButton.disabled=true;setStatus(validationStatus,'neutral','等待選取四份 Excel。');setStatus(publishStatus,'neutral','尚未送出。');}
  function refreshLuacActions(){const confirmed=state.luacSourceMode!=='bql_cache'||bqlConfirm.checked;luacPublishButton.disabled=!(state.luacData&&state.luacPublishEligible&&confirmed&&state.config.luac_enabled);bloombergButton.disabled=!(state.bridgeReady&&state.luacData&&confirmed);}
  function clearLuac(){state.luacData=null;state.luacSourceMode=null;state.luacPublishEligible=false;luacFile.value='';luacFileName.textContent='尚未選取';luacValidationSummary.hidden=true;bqlConfirm.checked=false;bqlConfirmWrap.hidden=true;bloombergSummary.hidden=true;refreshLuacActions();setStatus(luacValidationStatus,'neutral','等待選取 LUAC Excel。');setStatus(luacPublishStatus,'neutral','尚未送出。');}
  function refreshSupplyActions(){supplyPublishButton.disabled=!(state.supplyData&&state.supplyPublishEligible&&state.config.supply_enabled);}
  function clearPeer(){peerFile.value='';peerFileName.textContent='沿用現行 mapping';state.luacData=null;state.luacSourceMode=null;state.luacPublishEligible=false;state.supplyData=null;bqlConfirm.checked=false;bqlConfirmWrap.hidden=true;refreshLuacActions();refreshSupplyActions();setStatus(luacValidationStatus,'neutral','等待選取 LUAC Excel。');setStatus(supplyValidationStatus,'neutral','等待選取 Supply Excel。');}
  function clearSupply(){state.supplyData=null;state.supplyPublishEligible=false;supplyFile.value='';supplyFileName.textContent='尚未選取';supplyValidationSummary.hidden=true;refreshSupplyActions();setStatus(supplyValidationStatus,'neutral','等待選取 Supply Excel。');setStatus(supplyPublishStatus,'neutral','尚未送出。');}
  async function validateFiles(){
    const missing=METRICS.filter(metric=>!state.files[metric]);
    if(missing.length){setStatus(validationStatus,'error',`缺少：${missing.join('、')}`);return;}
    setStatus(validationStatus,'neutral','正在本機解析四份 Excel…');
    try{
      const parsed=await Promise.all(METRICS.map(metric=>parseWorkbook(state.files[metric],metric))),dates=parsed.flatMap(item=>item.dates),unique=[...new Set(dates.map(item=>item.date))];
      if(dates.length!==92)throw Error(`應有 92 個資料日期，實際為 ${dates.length}`);
      if(unique.length!==1){const sample=dates.filter(item=>item.date!==dates[0].date).slice(0,4).map(item=>`${item.metric}／${item.section}／${item.sector}=${item.date}`).join('；');throw Error(`Excel 內嵌日期不一致：${sample}`);}
      const date=unique[0];
      if(state.currentDate&&date<=state.currentDate)throw Error(`資料日期 ${date} 必須晚於正式站 ${state.currentDate}；同日修正請走人工 PR`);
      const sections={};
      for(const section of Object.keys(SECTIONS)){sections[section]={};for(const item of parsed)sections[section][item.metric]=item.result[section];}
      const data={date,horizon:'2Y',sections},count=validateSnapshot(data);
      state.data=data;state.files={};for(const input of inputs.values())input.value='';
      document.querySelector('#summary-date').textContent=date;document.querySelector('#summary-count').textContent=`${count} / 460`;validationSummary.hidden=false;
      setStatus(validationStatus,'success','驗證通過。原始 Excel 已從程式狀態釋放，只保留公開摘要資料。');
      publishButton.disabled=!state.config.enabled;
    }catch(error){state.data=null;publishButton.disabled=true;setStatus(validationStatus,'error',error.message||String(error));}
  }
  async function validateLuacFile(){
    const file=luacFile.files[0];
    if(!file){setStatus(luacValidationStatus,'error','請先選取 LUAC Excel。');return;}
    setStatus(luacValidationStatus,'neutral','正在本機解析 LUAC Excel…');
    try{
      const definitions=await parsePeerDefinitions(peerFile.files[0]||null,state.currentLuacPeers);
      if(!definitions.length)throw Error('正式站與上傳檔都沒有 Peer Group mapping');
      const parsed=await parseLuacWorkbook(file,definitions),data=parsed.data,count=data.records.length,anomalies=data.records.filter(record=>record[10].length).length;
      if(state.currentLuacDate&&data.date<state.currentLuacDate)throw Error(`資料日期 ${data.date} 早於正式站 ${state.currentLuacDate}`);
      if(state.currentLuacCount){const low=state.currentLuacCount*.8,high=state.currentLuacCount*1.2;if(count<low||count>high)throw Error(`債券筆數由 ${state.currentLuacCount} 變為 ${count}，超過 ±20%，需走人工 PR`);}
      state.luacData=data;state.luacSourceMode=parsed.sourceMode;state.luacPublishEligible=!state.currentLuacDate||data.date>=state.currentLuacDate;luacFile.value='';luacFileName.textContent='原始檔已從程式狀態釋放';
      document.querySelector('#luac-summary-date').textContent=data.date;document.querySelector('#luac-summary-count').textContent=count.toLocaleString('en-US');document.querySelector('#luac-summary-anomalies').textContent=anomalies.toLocaleString('en-US');document.querySelector('#luac-summary-source').textContent=parsed.sourceMode==='bql_cache'?'BQL 已儲存快取':'純值 Excel';luacValidationSummary.hidden=false;
      bqlConfirm.checked=false;bqlConfirmWrap.hidden=parsed.sourceMode!=='bql_cache';
      const sameDate=data.date===state.currentLuacDate?' 資料日與正式站相同，將建立同日更正 PR。':'';
      setStatus(luacValidationStatus,'success',`驗證通過。原始 Excel 已釋放，只保留精簡公開資料。${sameDate}`);refreshLuacActions();
    }catch(error){state.luacData=null;state.luacSourceMode=null;state.luacPublishEligible=false;bqlConfirm.checked=false;bqlConfirmWrap.hidden=true;refreshLuacActions();setStatus(luacValidationStatus,'error',error.message||String(error));}
  }
  async function validateSupplyFile(){
    const file=supplyFile.files[0];if(!file){setStatus(supplyValidationStatus,'error','請先選取 Supply Excel。');return;}
    setStatus(supplyValidationStatus,'neutral','正在本機解析 Supply Excel…');
    try{
      const data=await parseSupplyWorkbook(file);
      if(state.currentSupply&&data.date<state.currentSupply.date)throw Error(`資料日期 ${data.date} 早於正式站 ${state.currentSupply.date}`);
      if(state.currentSupply){for(const [field,label] of [['row_count','筆數'],['ytd_usd','YTD 發行量']]){const ratio=data[field]/state.currentSupply[field];if(ratio<.8||ratio>1.2)throw Error(`Supply ${label}變動超過 ±20%，需走人工 PR`);}}
      state.supplyData=data;state.supplyPublishEligible=!state.currentSupply||data.date>=state.currentSupply.date;supplyFile.value='';supplyFileName.textContent='原始檔已從程式狀態釋放';
      document.querySelector('#supply-summary-date').textContent=data.date;document.querySelector('#supply-summary-count').textContent=data.row_count.toLocaleString('en-US');document.querySelector('#supply-summary-ytd').textContent=`$${(data.ytd_usd/1e9).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}bn`;document.querySelector('#supply-summary-corrections').textContent=data.quality.date_corrections.toLocaleString('en-US');document.querySelector('#supply-summary-duplicates').textContent=data.quality.duplicate_cusip_groups.toLocaleString('en-US');supplyValidationSummary.hidden=false;
      const same=data.date===state.currentSupply?.date?' 資料日與正式站相同，將建立同日更正 PR。':'';setStatus(supplyValidationStatus,'success',`驗證通過。原始 Excel 已釋放，只保留聚合後的公開資料。${same}`);refreshSupplyActions();
    }catch(error){state.supplyData=null;state.supplyPublishEligible=false;refreshSupplyActions();setStatus(supplyValidationStatus,'error',error.message||String(error));}
  }
  const endpoint=path=>`${state.config.api_url.replace(/\/$/,'')}${path}`;
  async function api(path,options={}){
    const response=await fetch(endpoint(path),{...options,headers:{'Content-Type':'application/json',...(state.token?{Authorization:`Bearer ${state.token}`}:{ }),...(options.headers||{})}});
    const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
    if(!response.ok)throw Error(body.error||`HTTP ${response.status}`);
    return body;
  }
  async function testService(){
    if(!state.config.api_url){setStatus(publishStatus,'error','尚未設定更新服務網址。');return;}
    try{const response=await fetch(endpoint('/health'),{cache:'no-store'});const text=await response.text();if(!response.ok)throw Error(text||`HTTP ${response.status}`);setStatus(publishStatus,'success',text);}
    catch(error){setStatus(publishStatus,'error',`公司網路無法連線更新服務：${error.message}`);}
  }
  async function pollStatus(id){
    for(let attempt=0;attempt<60;attempt++){
      const result=await api(`/status/${encodeURIComponent(id)}`);
      setStatus(publishStatus,result.state==='failed'?'error':result.state==='deployed'?'success':'neutral',result.message);
      if(['failed','deployed'].includes(result.state))return;
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
    setStatus(publishStatus,'error','等待超過 10 分鐘；資料可能仍在 GitHub 執行，請稍後查看正式網站。');
  }
  async function pollLuacStatus(id){
    for(let attempt=0;attempt<60;attempt++){
      const result=await api(`/status/luac/${encodeURIComponent(id)}`);
      setStatus(luacPublishStatus,result.state==='failed'?'error':result.state==='deployed'?'success':'neutral',result.message);
      if(['failed','deployed'].includes(result.state))return;
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
    setStatus(luacPublishStatus,'error','等待超過 10 分鐘；單券資料可能仍在 GitHub 執行，請稍後查看正式網站。');
  }
  async function pollSupplyStatus(id){
    for(let attempt=0;attempt<60;attempt++){
      const result=await api(`/status/supply/${encodeURIComponent(id)}`);setStatus(supplyPublishStatus,result.state==='failed'?'error':result.state==='deployed'?'success':'neutral',result.message);if(['failed','deployed'].includes(result.state))return;await new Promise(resolve=>setTimeout(resolve,10000));
    }
    setStatus(supplyPublishStatus,'error','等待超過 10 分鐘；Supply 資料可能仍在 GitHub 執行。');
  }
  async function publish(){
    if(!state.data||!state.config.enabled)return;
    const secret=password.value;
    if(!secret){setStatus(publishStatus,'error','請輸入上傳密碼。');return;}
    publishButton.disabled=true;setStatus(publishStatus,'neutral','正在登入更新服務…');
    try{
      const session=await api('/session',{method:'POST',body:JSON.stringify({password:secret})});state.token=session.token;password.value='';
      setStatus(publishStatus,'neutral','驗證成功，正在建立資料更新 PR…');
      const job=await api('/publish',{method:'POST',body:JSON.stringify({data:state.data})});
      await pollStatus(job.id);
    }catch(error){setStatus(publishStatus,'error',error.message||String(error));publishButton.disabled=false;}
  }
  async function publishLuac(){
    if(!state.luacData||!state.luacPublishEligible||!state.config.luac_enabled||(state.luacSourceMode==='bql_cache'&&!bqlConfirm.checked))return;
    const secret=luacPassword.value;
    if(!secret){setStatus(luacPublishStatus,'error','請輸入上傳密碼。');return;}
    luacPublishButton.disabled=true;setStatus(luacPublishStatus,'neutral','正在登入更新服務…');
    try{
      const session=await api('/session',{method:'POST',body:JSON.stringify({password:secret})});state.token=session.token;luacPassword.value='';
      setStatus(luacPublishStatus,'neutral','驗證成功，正在建立單券資料更新 PR…');
      const job=await api('/publish/luac',{method:'POST',body:JSON.stringify({data:state.luacData})});
      await pollLuacStatus(job.id);
    }catch(error){setStatus(luacPublishStatus,'error',error.message||String(error));refreshLuacActions();}
  }
  async function publishSupply(){
    if(!state.supplyData||!state.supplyPublishEligible||!state.config.supply_enabled)return;const secret=supplyPassword.value;if(!secret){setStatus(supplyPublishStatus,'error','請輸入上傳密碼。');return;}supplyPublishButton.disabled=true;setStatus(supplyPublishStatus,'neutral','正在登入更新服務…');
    try{const session=await api('/session',{method:'POST',body:JSON.stringify({password:secret})});state.token=session.token;supplyPassword.value='';setStatus(supplyPublishStatus,'neutral','驗證成功，正在建立 Supply 資料 PR…');const job=await api('/publish/supply',{method:'POST',body:JSON.stringify({data:state.supplyData})});await pollSupplyStatus(job.id);}catch(error){setStatus(supplyPublishStatus,'error',error.message||String(error));refreshSupplyActions();}
  }
  const bridgeEndpoint=path=>`http://127.0.0.1:8768${path}`;
  async function bridgeRequest(path,options={}){
    const response=await fetch(bridgeEndpoint(path),{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${bridgeToken}`,...(options.headers||{})}});
    const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));if(!response.ok)throw Error(body.error||`HTTP ${response.status}`);return body;
  }
  async function initializeBloombergBridge(){
    if(!bridgeToken)return;
    try{const health=await bridgeRequest('/health');if(!health.ready)throw Error('Bloomberg bridge 尚未就緒');state.bridgeReady=true;bloombergPanel.hidden=false;setStatus(bloombergStatus,'success','已連線本機 Bloomberg bridge；驗證 Excel 後即可執行唯讀診斷。');refreshLuacActions();}
    catch(error){state.bridgeReady=false;refreshLuacActions();}
  }
  const summaryItem=(label,value)=>{const wrapper=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=String(value);wrapper.append(term,description);return wrapper;};
  async function probeBloomberg(){
    if(!state.bridgeReady||!state.luacData||bloombergButton.disabled)return;
    bloombergButton.disabled=true;bloombergSummary.hidden=true;setStatus(bloombergStatus,'neutral','正在查詢 Bloomberg LUACTRUU 成分與欄位，請勿關閉 Terminal…');
    try{
      const result=await bridgeRequest('/probe',{method:'POST',body:JSON.stringify({data:state.luacData})});bloombergSummary.replaceChildren();
      for(const [label,value] of [['連線',result.connected?'成功':'失敗'],['單券 Reference',result.reference_ok?'通過':'失敗'],['Universe',result.universe_ok?'通過':'失敗'],['成分筆數',Number(result.count||0).toLocaleString('en-US')],['欄位覆蓋',`${result.required_field_coverage_pct??0}%`],['ID 集合',result.ids_match?'一致':'不一致'],['BICS Level 1',result.industry_match?'一致':'不一致'],['靜態欄位差異',Number(result.static_mismatch_count||0).toLocaleString('en-US')],['產業差異',Number(result.industry_mismatch_count||0).toLocaleString('en-US')],['最大 OAS 差異',Number.isFinite(result.max_oas_diff_bp)?`${result.max_oas_diff_bp} bp`:'n.a.'],['最大 Yield 差異',Number.isFinite(result.max_yield_diff_pct)?`${result.max_yield_diff_pct} pct pt`:'n.a.']])bloombergSummary.append(summaryItem(label,value));
      bloombergSummary.hidden=false;setStatus(bloombergStatus,result.passed?'success':'error',result.passed?'Bloomberg API 診斷全部通過；本次未建立 PR。':`診斷未通過：${result.error_class||'comparison_failed'}`);
    }catch(error){setStatus(bloombergStatus,'error',`Bloomberg API 診斷失敗：${error.message||String(error)}`);}
    finally{refreshLuacActions();}
  }
  async function initialize(){
    try{
      const [config,current,currentLuac,currentSupply]=await Promise.all([fetch('assets/upload-config.json',{cache:'no-store'}).then(r=>r.json()),fetch('assets/rv-data.json',{cache:'no-store'}).then(r=>r.json()),fetch('assets/luac-bonds.json',{cache:'no-store'}).then(r=>r.json()),fetch('assets/supply-data.json',{cache:'no-store'}).then(r=>r.json())]);
      state.config=config;state.currentDate=current.date;state.currentLuacDate=currentLuac.date;state.currentLuacCount=currentLuac.records.length;state.currentLuacPeers=currentLuac.peer_definitions||[];state.currentSupply=window.SupplyModel.validateSnapshot(currentSupply);
      serviceState.textContent=config.enabled?'更新服務已啟用。驗證資料後即可發布。':'更新服務尚未啟用；目前只能在本機驗證 Excel。';
      password.disabled=!config.enabled;luacPassword.disabled=!config.luac_enabled;supplyPassword.disabled=!config.supply_enabled;refreshLuacActions();refreshSupplyActions();
      if(!config.luac_enabled)setStatus(luacPublishStatus,'neutral','單券資料發布尚未啟用；目前只能在本機驗證。');
      if(!config.supply_enabled)setStatus(supplyPublishStatus,'neutral','Supply 資料發布尚未啟用；目前只能在本機驗證。');
    }catch(error){serviceState.textContent='無法讀取更新服務設定。';setStatus(publishStatus,'error',error.message||String(error));}
  }
  for(const [metric,input] of inputs){input.addEventListener('change',()=>{if(input.files[0])choose(metric,input.files[0]);});}
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');assign([...event.dataTransfer.files]);});
  drop.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();inputs.get('Spread').click();}});
  document.querySelector('#clear-files').addEventListener('click',clear);
  document.querySelector('#validate-files').addEventListener('click',validateFiles);
  document.querySelector('#test-service').addEventListener('click',testService);
  publishButton.addEventListener('click',publish);
  luacFile.addEventListener('change',()=>{if(luacFile.files[0]){luacFileName.textContent=luacFile.files[0].name;state.luacData=null;state.luacSourceMode=null;state.luacPublishEligible=false;luacValidationSummary.hidden=true;bqlConfirm.checked=false;bqlConfirmWrap.hidden=true;refreshLuacActions();setStatus(luacValidationStatus,'neutral','檔案已變更，請重新驗證。');}});
  document.querySelector('#clear-luac').addEventListener('click',clearLuac);
  document.querySelector('#validate-luac').addEventListener('click',validateLuacFile);
  bqlConfirm.addEventListener('change',refreshLuacActions);bloombergButton.addEventListener('click',probeBloomberg);
  luacPublishButton.addEventListener('click',publishLuac);
  supplyFile.addEventListener('change',()=>{if(supplyFile.files[0]){supplyFileName.textContent=supplyFile.files[0].name;state.supplyData=null;supplyValidationSummary.hidden=true;refreshSupplyActions();setStatus(supplyValidationStatus,'neutral','檔案已變更，請重新驗證。');}});
  peerFile.addEventListener('change',()=>{if(peerFile.files[0]){peerFileName.textContent=peerFile.files[0].name;state.luacData=null;state.luacSourceMode=null;state.luacPublishEligible=false;state.supplyData=null;luacValidationSummary.hidden=true;supplyValidationSummary.hidden=true;bqlConfirm.checked=false;bqlConfirmWrap.hidden=true;refreshLuacActions();refreshSupplyActions();setStatus(luacValidationStatus,'neutral','Peer mapping 已變更，請重新驗證 LUAC Excel。');setStatus(supplyValidationStatus,'neutral','Peer mapping 已變更，請重新驗證 Supply Excel。');}});
  document.querySelector('#clear-peer').addEventListener('click',clearPeer);
  document.querySelector('#clear-supply').addEventListener('click',clearSupply);document.querySelector('#validate-supply').addEventListener('click',validateSupplyFile);supplyPublishButton.addEventListener('click',publishSupply);
  initialize();initializeBloombergBridge();
})();
