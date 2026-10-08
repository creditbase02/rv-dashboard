# RV Dashboard 維運手冊

## 邊界與來源

- 本 repository 只負責 `https://creditbase02.github.io/rv-dashboard/`。
- `ib-knowledge-base` 是獨立 peer；本 repo 不得修改或發布它。
- 私人來源位於 Review workspace。抽取程式只讀來源，僅將通過驗證的 `assets/rv-data.json`、`assets/luac-bonds.json` 與 `assets/supply-data.json` 寫入本 repo。
- 稽核 JSON 必須寫到 repo 外；Excel、PPT、PDF、絕對路徑與來源雜湊不得公開。

## 每次開始工作

1. `git fetch origin`，從 `origin/main` 建立 `codex/<task>` branch 或 Codex worktree。
2. 完整閱讀本文件與 `AGENTS.MD`。
3. 執行 `python3 peer_status.py`，記錄知識庫最後穩定版本；peer 暫時離線是警告，不代表可修改對方 repo。
4. 確認 `git status` 沒有不屬於本任務的變更。

### 判斷目前正式狀態

- 使用者問「目前」、「已鎖定至何日」、「為什麼當期檔案檢核失敗」或要求更新資料時，`git fetch origin` 是診斷前置條件，不只是建立 branch 的步驟。先確認本機是否落後；不得用落後 checkout 內的 `assets/*.json`、先前對話記憶或本文件的敘述日期判斷目前狀態。
- 至少交叉核對 `origin/main` 的資料資產與正式站同一資產。正式站請加一次性 query string 避開 GitHub Pages 快取，例如 `assets/supply-data.json?check=<timestamp>`；Supply 至少比較 `date`、`row_count`、`ytd_usd`、`lock.version` 與 `lock.through`。
- `origin/main` 與正式站一致時，才以該版本診斷上傳檔。兩者不一致時，先視為尚未部署或快取／發布異常，查 manifest、Pages 狀態與 cache-buster 回應，不得自行選較舊版本作結論。
- 文件中的「目前版本」只是在該 commit 完成時的紀錄，不是即時資料來源。即使段落列出明確版本與日期，新的對話仍須執行上述核對。

## 更新資料

### 網頁自動更新（Excel 嚴格模式）

正式站的「更新資料」頁固定接受 Spread、10Y、30Y、10s30s 四份 `.xlsx`。瀏覽器必須確認 460 個數值完整、92 個內嵌日期一致、percentile 在 0–100% 內，且每筆符合 Min ≤ Median ≤ Max。資料日期必須晚於正式站；同日修正仍走人工 PR。

原始工作簿只在瀏覽器記憶體解析。RV／LUAC 網路 request 只能包含 `{data: <public snapshot>}`，不得包含工作簿 bytes、檔名、路徑或來源雜湊。Worker 會重做同一套 schema 與數值驗證。

自動資料 PR 的安全條件全部成立才可合併：

- 作者必須等於 repository variable `RV_UPLOAD_APP_LOGIN`。
- branch 必須以 `automation/rv-data-` 開頭。
- PR 必須有 `automated-rv-data` label。
- diff 必須且只能是 `assets/rv-data.json`。
- 快速資料 CI 必須通過；它只驗證公開資料與建置結果，不重跑未變更的網站、Worker 或瀏覽器程式。

任何包含第二個檔案或程式碼的 PR 都不得自動合併。

### LUAC 單券資料

正式來源必須是單一工作表、BICS Level 1 產業的 `.xlsx`，支援兩種輸入格式：每券一列的 10 欄合併格式，或原有 11 欄靜態／行情雙區塊格式。10 欄格式依序為 ID、SECURITY_DES、LONG_COMP_NAME、TICKER、MATURITY、BB_COMPOSITE、MTY_YEARS_TDY、OAS、Yield、BICS Level 1，因檔內沒有 DATES，上傳頁必須由使用者輸入行情資料日期；不得依檔名、檔案時間或系統日期推定。11 欄格式仍從各行情列的 DATES 讀取單一資料日；若上傳頁另填日期，必須與檔內日期一致。允許無公式純值檔，或恰好一個 BQL 公式且已完成更新、儲存快取值的檔案；其他公式、缺失快取、缺值、非有限數字、重複 ID、舊格式不匹配 ID、或舊格式混合資料日都拒絕整批更新。瀏覽器無法重新計算 BQL，發布前必須由使用者確認已在 Excel 更新完成並儲存。公開 schema v2 另含 `peer_definitions`（TICKER 對應 Peer Group），`columns` 與每筆公開記錄仍為 11 欄；`bonds.html` 的第二層篩選可在產業與 Peer Group 之間切換（切換時清除另一邊的勾選，兩者不會同時生效），Peer Group 模式只顯示已分類債券。Peer mapping 是含 `TICKER` 與 `Peer Group` 兩欄的選填 Excel（與 Supply 共用同一份）；網頁未提供時沿用目前公開快照內的 mapping。以下命令只輸出精簡公開 contract，私人 audit 必須在 repo 外；10 欄格式加上 `--date YYYY-MM-DD`，11 欄格式可省略：

```sh
python3 scripts/extract_luac.py <LUAC.xlsx> \
  --peers <Peer-Groups.xlsx> \
  --date YYYY-MM-DD \
  --output assets/luac-bonds.json \
  --audit <repo之外>/luac-audit.json
```

Yield、期限或 OAS 超出公開規則時保留原始數值並標記，但預設圖表與所有 LOWESS 曲線排除。自動更新另要求資料日晚於正式快照，且筆數變動不得超過 ±20%；否則必須走人工 PR。

LUAC 自動資料 PR 的安全條件為：作者等於 `RV_UPLOAD_APP_LOGIN`、branch 以 `automation/luac-data-` 開頭、label 為 `automated-luac-data`、diff 只有 `assets/luac-bonds.json`，且完整 CI 通過。`LUAC_UPLOAD_ENABLED` 與網站 `luac_enabled` 是獨立開關，未完成公司網路 preview 與當期資料核對前保持 `false`。

Bloomberg Desktop API 僅可在已登入 Terminal 的公司 Windows 電腦做唯讀實驗：

```powershell
python scripts/probe_bloomberg_luac.py --known-security "<approved Bloomberg ID>" --snapshot-output "$env:TEMP\luac-api.json" --compare "$env:TEMP\luac-excel.json"
```

網站式診斷可在 repository 根目錄執行 `powershell -File scripts/start_bloomberg_bridge.ps1`。bridge 只綁定 `127.0.0.1:8768`、使用每次啟動的隨機 token，只回傳彙總比對結果，且不呼叫發布 Worker。

診斷只輸出成功狀態、筆數、欄位覆蓋與錯誤分類。完整 universe、唯一 ID、必填欄位 100%，且同工作階段比對達 OAS ≤0.5 bp、Yield ≤0.01 個百分點前，不得接正式更新。

### IG Supply 資料

Supply 使用「私人鎖定基準＋未鎖定期間整段替換」。目前版本 `reviewed-20260930-v1` 鎖定至 2026/09/30，YTD 1,678,375,719,000 USD，9月 195,300,000,000 USD，共1,661個發行事件。初始版本 `reviewed-20260925-v1` 鎖定至 2026/09/25，包含1,651個發行事件、YTD 1,646,875,719,000 USD及9月163,800,000,000 USD。兩版均包含JBS原發行與增額拆分，不能以來源列數推斷交易數。Athene等原稽核證據限制保留於私人報告，未為符合外部四捨五入數字改變統計範圍。

上述版本與數字是歷史紀錄，不得在新的診斷中視為即時狀態。每次 Supply 更新或失敗排查仍須依「判斷目前正式狀態」重新讀取 `origin/main` 與正式站的 `assets/supply-data.json`；檢核規則必須套用該快照的 `lock.through`，不能套用本機舊快照的鎖定日。

來源欄位仍須包含 `BB ID`、`CUSIP`、`Ticker`、`Corp Ticker`、`Pricing Date`、`Tranche Size`、`Tenor`、`Ind Sector`、`BB Composite`。逐列識別時，有有效 CUSIP 即可，不強制 BB ID；已鎖定期間只有 BB ID 與 CUSIP 同時缺失才停止並要求人工核對。不再依相鄰列推定日期。所有已鎖定識別碼及原始錯誤別名先匹配；截止日前資料不能替換基準。疑似舊券改期或同CUSIP增額必須先核對；有證據的新增額以私人基準中的精確 `approved_events` 核准，不能只核准一個CUSIP。重複發行事件整批拒絕。

Supply 是一般上傳契約的明確例外：原始Excel與檔名、路徑不離開瀏覽器；登入後將識別碼SHA-256及定價日、金額、產業、評級、期限bucket、公司ticker送往私人服務。雜湊不是匿名化，這些最小核對資料不得寫入公開資產、PR或日誌。RV與LUAC原有上傳契約不變。私人台帳及基準位於repo外；Worker的`SUPPLY_PRIVATE` KV保存不公開的基準與未鎖定事件，沒有瀏覽器寫入基準的API。`SUPPLY_SIGNING_KEY`是Ed25519私人JWK secret，僅公鑰存於`assets/supply-lock.json`。

更新頁須輸入資料截止日、確認完整未鎖定期間並登入。`POST /validate/supply`與`POST /publish/supply`都接收 `{data:{baseline_version,parent,as_of,complete,records}}`，都重新合併及驗證私人基準。前者只回公開預覽與忽略筆數，後者只將簽章公開彙總寫入資料PR。截止日不能倒退；跨年須人工建立新年度基準。前版已發布的未鎖定事件不得缺列或改期；使用者仍須確認尚未被任何清單捕捉的新發行完整性。上傳新Peer mapping不得改寫歷史分類，Supply需先清除該選取。

公開schema v4保留既有彙總欄位，新增`lock`：版本、截止日、前版公開快照digest與服務簽章。無逐券記錄或識別雜湊。Top 5以私人完整事件重算，不拼接兩份Top 5。基準的金額、日期及分類不隨新Excel更新；YTD、占比及排行會因新增交易正常改變。頁面分別顯示資料日與核對鎖定日。跨站manifest維持既有介面。

`assets/supply-lock.json`只可經人工PR升版。建置驗證Ed25519簽章；快速CI另驗證parent必須等於當前基準版本的前一公開快照，防止並行上傳以舊版本覆蓋新資料。缺失私人基準、簽章key、前版事件、版本不符或未決識別問題均停止發布。保留±20%變動、256KiB公開資產限制及原有可信任單檔PR條件。變更程式或基準設定仍跑完整CI。

#### 月底封帳／維運

1. 在repo外核對未鎖定期間，保存證據與修正；保留每筆既有基準記錄及原始識別別名，追加新事件。新版本不得改變舊基準記錄或Peer mapping。新年份獨立建立基準，舊年度永久歸檔。
2. 使用 `node scripts/seal_supply_baseline.mjs --baseline <私人新基準.json> --previous <私人舊基準.json> --key <私人簽章key.json> --output <repo外目錄>` 產生簽章彙總；工具拒絕改寫已封帳事件。僅將輸出的兩份公開檔複製至assets。
3. 先以Wrangler將私人新基準寫入獨立KV key `baseline:<新版本>`；普通上傳無權覆蓋。保留舊key及私人離線備份。人工PR包含新lock設定與公開彙總，完整CI通過後合併。
4. Worker需同步部署以採用新版本／公鑰，版本切換期間服務安全拒絕上傳，頁面顯示重新載入；部署完成後驗證health、私有核對與公開簽章。不得刪除舊私人基準或歷史公開快照。
5. `tail:<公開快照digest>`於建立PR前保存；PR失敗留下的孤立key無法影響正式版本。缺少已發布快照的tail紀錄時停止更新，從私人備份還原，不用新Excel猜測。當並行PR的parent過期時，重新載入並驗證完整新清單。

首次部署先備份現行Worker版本、配置KV基準與簽章secret；完整CI通過後透過PR發布基準，部署Worker並驗證。回復須同時匹配前版公開基準、Worker及私人KV key，不得只關閉鎖定驗證。

### 人工抽取（含投影片 fallback）

```sh
python3 scripts/extract_rv.py \
  --workbooks <Spread.xlsx> <10Y.xlsx> <30Y.xlsx> <10s30s.xlsx> \
  --deck <reviewed-v2-deck.pptx> \
  --date YYYY-MM-DD \
  --slide-date YYYY-MM-DD \
  --audit ../../rv-audits/YYYY-MM-DD.json
```

`--slide-date` 是人工核對後的資料日期，不得用檔案建立或修改時間代替。只要投影片與 Excel 差異超過容許值，抽取器會停止替換公開快照。

如需在 repo 外比對網頁 Excel 嚴格模式，可執行：

```sh
python3 scripts/extract_excel_strict.py \
  --workbooks <Spread.xlsx> <10Y.xlsx> <30Y.xlsx> <10s30s.xlsx> \
  --output <repo之外的暫存JSON>

# 另一個終端先啟動 public/ 靜態站，再比對瀏覽器與 Python 的 sanitized JSON
node scripts/verify_excel_browser_parity.cjs \
  http://127.0.0.1:8766/ <暫存JSON> \
  <Spread.xlsx> <10Y.xlsx> <30Y.xlsx> <10s30s.xlsx>
```

## 建置與驗證

可信任的自動資料 PR 若只修改 `assets/rv-data.json`，會保留既有 `tests` required check 名稱，但只執行：

```sh
python3 publish.py --build-only
python3 scripts/validate_fast_data.py \
  --current assets/rv-data.json \
  --previous <前一版rv-data.json> \
  --public-root public
```

快速驗證要求資料結構與分類完整、460 個有限數值無缺值、Excel 來源、percentile 範圍、Min／Median／Max 排序、新日期，以及公開 JSON、頁面日期與 manifest 相符。Excel 原檔的四份工作簿、工作表與 92 個內嵌日期仍由瀏覽器及 Worker 驗證。

可信任的 LUAC 自動資料 PR 若只修改 `assets/luac-bonds.json`，同樣走輕量資料驗證：嚴格檢查 schema、11 欄、`peer_definitions`、缺值、非有限數字、重複 ID、品質旗標、0Y–50Y 圖表可用資料、日期遞增、±20% 筆數、4 MiB 上限，以及建置後 asset、頁面日期與 manifest 一致。資料-only 更新不重跑 Playwright、LOWESS 模型與 Worker 單元測試；任何程式或第二個檔案的變更仍跑完整 CI。

可信任的 Supply 自動資料 PR 若只修改 `assets/supply-data.json`，會執行 `scripts/validate_fast_supply.py`，檢查 compact schema、精確加總、Rating／Tenor／Peer 順序、12 個月 reconciliation、日期不得倒退、筆數與 YTD ±20%、256 KiB 上限，以及建置後 asset、Supply 頁日期與 `datasets.supply` 一致。同日更正可通過。

任何程式碼、第二個檔案、不受信任作者／branch／label 的 PR 都走完整 CI：

```sh
python3 publish.py --build-only
python3 -m unittest discover -s tests -v
pnpm run test:model
pnpm run test:worker
pnpm run check:worker
python3 peer_status.py
python3 -m http.server 8766 --directory public
pnpm run test:browser -- http://127.0.0.1:8766/
```

完整 CI 必須通過 RV、LUAC 與 Supply schema、LOWESS、精確加總、Excel fixture、公開資料防洩漏、連結、manifest 與桌面／平板／手機 Playwright 測試。資料-only commit 合併至 `main` 後沿用快速驗證產生 Pages artifact；其他 `main` commit 仍走完整 CI。

## 發布與回復

- 推送 `codex/<task>` 並建立 PR；CI 通過後才合併 `main`。
- GitHub Pages 僅部署 `main`，正式站與知識庫使用不同 workflow 及 concurrency group。
- 發布後確認首頁、`bonds.html`、`supply.html`、三個公開資料 asset 與 `integration-manifest.json` 可讀。
- GitHub Pages 對 HTML 與 JS 一律回 `cache-control: max-age=600`。部署後約 10 分鐘內，使用者可能仍拿到舊的頁面與舊的 `?v=` asset，而資料 asset 已是新版本；若這次發布含破壞性 schema 變更，畫面會顯示「偵測到資料版本已更新」提示（Supply 頁），需使用者按「重新載入」才會取得新內容。這是 GitHub Pages 無法自訂標頭的限制，不是資料遺失，也不代表部署失敗；排查時先用 cache-buster 請求與全新瀏覽器 context 確認，再決定是否回退。
- 發布失敗時不修改知識庫；修正原 PR 或 `git revert <merge-commit>` 建立回復 PR。

## 上傳服務 rollout 與回復

穩定基準為 tag `rv-stable-before-upload-20260911`（commit `e26c23685cbec59a6d9e60f8dfab4122917a4a2d`、資料日 `2026-08-05`）。不得刪除歷史或 force-push `main`。

1. 先執行 `pnpm run deploy:worker:health`，記錄 Cloudflare version ID。此版本除 `/health` 外一律回覆未啟用。
2. 必須從公司電腦開啟 `/health` 並看到 `RV Upload Service OK`；若遭阻擋，立即停止，網站維持原狀。
3. 設定 preview Worker 的 encrypted secrets：`UPLOAD_PASSWORD`、`SESSION_SECRET`、`GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID`、`GITHUB_APP_PRIVATE_KEY`。GitHub App 只安裝在 `rv-dashboard`。
4. 以合成資料完成登入、PR、CI 測試；網站端 `assets/upload-config.json` 的 `enabled` 仍保持 `false`。
5. 用當期四份 Excel 比較瀏覽器結果與 `extract_excel_strict.py` 結果一致；LUAC 另需以當期 Peer Group Excel 或正式站現行 mapping 與 `extract_luac.py --peers` 的結果一致。
6. 最後才把需要啟用的 Worker `RV_UPLOAD_ENABLED`／`LUAC_UPLOAD_ENABLED`／`SUPPLY_UPLOAD_ENABLED` 與網站對應 config 都切成 `true`，並經 PR 發布。

失敗時依範圍回復：

- PR 合併前：關閉 PR 並刪除該工作 branch，正式站不受影響。
- Worker：執行 `wrangler rollback <health-version-id>` 回到已記錄的 health-only 版本。
- 網站程式：從穩定 tag 建立 revert PR，原有 CI 通過後合併。
- 錯誤資料：建立只恢復前一版 `assets/rv-data.json` 的 PR；若也涉及程式錯誤，完整 revert 到穩定基準。
- App 或密碼疑似外洩：先將 Worker 發布端點設為停用，再撤銷 App installation 並輪替所有 secrets。

## 跨站契約

- manifest schema 目前為 v1。新增欄位可向後相容；刪除、改名或改型別需建立 `COORD-YYYYMMDD-NN` 成對 PR。
- 先讓讀取方同時接受新舊 schema，再讓輸出方切換，最後才能移除舊欄位。
- peer 無法連線時，本地建置與內容發布只警告；每日 health workflow 必須失敗並通知。
- `integration-manifest.json` 代表最後已部署版本；未合併工作以 Git branch／PR 為準。
