# 單券 BQL 一鍵取數診斷

正式站提供手動 API 預覽，Excel 更新通路繼續保留。診斷按鈕透過本機 bridge 呼叫 BQL Python，先查單券，再查完整成分，回傳彙總比對結果；API 工作台則每次只查一次完整成分。API 尚無發布端點，也不把其快照交給既有 Excel 發布按鈕。

## 公司電腦前置確認

1. 在公司 Windows 電腦登入 Bloomberg Terminal，確認 `BQNT <GO>` 可執行 BQL。
2. 請 Bloomberg 支援確認：該帳號能否在**本機 Windows Python 程序**使用 Bloomberg 的 `bql.Service().execute()`，或使用下述第三方 `polars-bloomberg` 的 BQL 介面，並由本機 bridge 啟動該程序。請記錄核准的 Python 執行檔及環境。只在遠端 BQNT notebook 成功不算通過；不得自行複製 Bloomberg 套件、猜測內部 HTTP endpoint，或從 PyPI 安裝同名 `bql` 套件。
3. 詢問原公式的成分交集、BVAL BID OAS、Convention Yield、發行人 BICS 第 1 層是否均有權限，及報價日期回傳方式。確認本工具使用的 aliased BQL 查詢與 response `DATE` metadata 代表所需行情資料日期。語法或回應格式不符時停止，不切換成普通 ReferenceData 欄位。
4. 私人測試紀錄放在 repository 外，只需記錄環境類型、支援確認結果、測試時間及彙總結果。不保存 token、完整券表或 SDK 錯誤內容至 Git／公開站。

官方產品說明：[BQuant](https://professional.bloomberg.com/products/bloomberg-terminal/research/bquant/)、[BQuant Python／BQL 概覽](https://data.bloomberglp.com/professional/sites/10/489937_BBGT_BQUANT_Overview_MINI-1.pdf)。公開說明不構成本機呼叫權限或本查詢已實測成功的證明。

## 啟動及網頁操作

在專案根目錄建置並啟動本機網站：

```powershell
python publish.py --build-only
python -m http.server 8766 --bind 127.0.0.1 --directory public
```

另開 PowerShell 啟動診斷。未確認支援時，先不加確認開關，頁面將顯示缺少環境或支援確認：

```powershell
powershell -File scripts/start_bloomberg_bridge.ps1
```

取得 Bloomberg 確認後，使用其核准的本機 Python 執行檔啟動（下列路徑是佔位範例，須自行替換）：

```powershell
powershell -File scripts/start_bloomberg_bridge.ps1 `
  -BqlPython '<核准的本機 Python 執行檔>' -SupportedRuntimeConfirmed
```

### 可選的 polars-bloomberg 介面

這是第三方套件提供的 BQL 實作，並非 `bql.Service`；必須明確以 `-Provider polars-bloomberg` 選擇，不自動 fallback。它使用本機 blpapi 連線，作者實作會要求 BQL service 與 Excel client context；是否對公司帳號及本機程式用途受支援，仍須向 Bloomberg 確認。參見[作者 BQL 文件](https://marekozana.github.io/polars-bloomberg/usage/bql/)。不修改套件的 service 名稱、client context 或認證流程以繞過權限。

安裝時先從 [Bloomberg 官方套件來源](https://professional.bloomberg.com/support/api-library/) 安裝 `blpapi`，再從 PyPI 安裝第三方套件；只執行 `pip install polars-bloomberg` 可能因找不到 `blpapi>=3.24.0` 而回報 `ResolutionImpossible`。以下版本已於本機完成安裝、import 與 `pip check`，不代表帳號查詢權限通過：

```powershell
python -m venv .venv-bql
.\.venv-bql\Scripts\python.exe -m pip install --index-url=https://blpapi.bloomberg.com/repository/releases/python/simple/ 'blpapi==3.26.9.1'
.\.venv-bql\Scripts\python.exe -m pip install 'polars-bloomberg==0.6.0' 'polars==2.0.0'
.\.venv-bql\Scripts\python.exe -m pip check
.\.venv-bql\Scripts\python.exe scripts/probe_bloomberg_luac.py --health --provider polars-bloomberg
```

取得本機呼叫方式確認後，啟動：

```powershell
powershell -File scripts/start_bloomberg_bridge.ps1 `
  -BqlPython '.\.venv-bql\Scripts\python.exe' `
  -Provider polars-bloomberg -SupportedRuntimeConfirmed
```

診斷只呼叫作者公開的 `BQuery.bql()`，不呼叫 `bdp()`，關閉 debug，不用 `.combine()` 隱藏缺列；逐欄嚴格驗證與原生 BQL 介面相同。此隔離環境已被 Git 忽略。

啟動器預設開啟本機 `update.html`，token 僅放 URL fragment，不放 query string；關閉啟動器會停止 bridge。不要分享帶 token 的 URL。若日後頁面程式已經 PR 發布，可明確傳入 `-SiteUrl 'https://creditbase02.github.io/rv-dashboard/update.html'` 測公司瀏覽器跨來源／本機網路權限。尚未發布時請用預設本機頁面。

1. 複製原始 workbook 到 repository 外，僅將 `CLASSIFICATION_NAME(BICS,3,TYPE=ISSUER)` 改為 `CLASSIFICATION_NAME(BICS,1,TYPE=ISSUER)`；其他成分、BVAL、BID、Convention 參數保持原樣，原檔不覆寫。
2. 在同一工作階段刷新比較副本，等待 BQL 完成並儲存，從可信行情來源核對資料日期；10 欄格式沒有內嵌日期，網頁須手填。不要直接以今天當作行情日期。
3. 到單券區選擇比較副本、執行「在本機驗證」，確認 BQL 已更新的勾選，再勾選診斷區的同工作階段確認。Peer Group 比對一律沿用網站現行 mapping。
4. 按「一鍵查詢並比對 BQL」。載入網頁與 health 都不發出市場查詢；按鈕才啟動單券及完整查詢。不要按既有的 Excel 發布按鈕。
5. 記錄頁面顯示的彙總結果。重新選檔、改日期或重新驗證後，須重新確認工作階段並診斷。

## 查詢及驗收

`scripts/probe_bloomberg_luac.py` 集中保存查詢。Universe 為 active bonds 與 LUACTRUU 的交集，保留 `CONSOLIDATEDUPLICATES='N'`。OAS 為 `SPREAD(ST='OAS',PRICING_SOURCE=BVAL,SIDE=BID)`，Yield 為 `YIELD(YT=CONVENTION,PRICING_SOURCE=BVAL,SIDE=BID)`，產業為 `CLASSIFICATION_NAME(BICS,1,TYPE=ISSUER)`。

每個 BQL item 按 ID 嚴格合併；重複 ID、缺欄、缺值、非有限數字、部分回應均停止。OAS 與 Yield 每列的 `DATE` 必須完整且一致，並與比較 Excel 資料日相符；單券與全體查詢也須同日。沒有 DATE 就回 `market_date_unverified`，不從 Excel 日期或電腦時鐘補值。

通過條件：完整 ID 集合一致、所有必填欄位有效、名稱／發行人／ticker／到期日／評級／產業一致，OAS 最大差異 ≤0.5 bp，Yield 最大差異 ≤0.01 個百分點。沿用 schema v2 與既有品質旗標；異常值保留並標記，不跳過該券湊出成功。

bridge 僅綁定 loopback；每個實際請求都檢查 Origin 與 token。一次只跑一個診斷；polars-bloomberg 的單次事件等待上限為 120 秒，整個子程序最長 270 秒，網頁最長等待 280 秒。逾時停止，不重試全體查詢。SDK 輸出不轉送給網頁或寫入日誌。診斷回應沒有逐券記錄、工作簿資訊或來源路徑。

## 判定及失敗處理

- `bql_runtime_unavailable`：指定環境無 BQL；`blpapi` 安裝成功不等於可用 BQL。
- `supported_runtime_unconfirmed`：先向 Bloomberg 確認本機程序呼叫方式；不因 notebook 成功而開放。
- `terminal_connection`／`not_authorized`：檢查登入與資料權限。
- `query_timeout`：查詢已停止；先確認服務狀態，再由使用者重新觸發。
- `bql_response_shape`／`bql_query_failed`：由 Bloomberg 確認當地 SDK 語法及回應結構，不嘗試非公開介面。
- 缺值、部分回應、日期未知或比較不一致：保留正式資料，重新核對來源與口徑。

模組存在與 Terminal port 可連線僅是環境線索；health 不驗證登入或權限。只有公司電腦上，核准的本機呼叫方式與瀏覽器端點實測成功、同工作階段全量比對通過，才能判定一鍵取數可行。若只可用遠端 BQNT，請記錄「本機網頁呼叫路徑未成立」，向 Bloomberg 詢問受支援整合方式。

通過後另行實作預覽與確認發布至 `/publish/luac`；本版本不修改 Worker、公開資料資產或正式發布流程。

## 開發驗證

Python 單元測試納入既有 `unittest discover`；合成 BQL 回應測試不需要 Terminal。桌面／手機網頁測試以 mock bridge 驗證確認勾選、明確觸發、環境錯誤及不發布，納入完整 CI 的瀏覽器階段。手動重跑可使用：

```powershell
python -m unittest discover -s tests -p 'test_bql_probe.py' -v
python -m unittest discover -s tests -p 'test_bloomberg_bridge.py' -v
# 另一個視窗保持 8766 本機網站運作
pnpm run test:bql -- http://127.0.0.1:8766/
```

這些測試通過僅證明工具流程，不等同公司 Bloomberg 權限或查詢已通過實測。
## 正式站 API 預覽（保留 Excel 更新）

### 一般使用者：從網站下載 Windows 啟動包

正式頁的「啟動這台電腦的 Bloomberg 連線」提供 `downloads/RV-BQL-Launcher.zip`。解壓縮後，首次雙擊 `Setup.cmd`，以標準版 64 位元 CPython 3.12、3.13 或 3.14 在該資料夾建立隔離環境並安裝固定版本套件；每次登入 Bloomberg 後雙擊 `Start.cmd`，自動開啟帶憑證的網頁。啟動器命令視窗須保持開啟，Ctrl+C 停止服務。公司套件下載限制或缺少 Python 時，網站提供 IT／安裝指引，不修改系統安全政策。

下載包只包含明確允許的啟動及驗證原始碼、中文說明與 CMD 檔，不打包 SDK 二進位檔、Python 執行環境、Excel、行情或憑證。單獨啟動時只下載公開的 `assets/luac-peer-definitions.json`，驗證後交給 bridge；沒有下載完整行情快照。只有使用者按取數按鈕才發 BQL 查詢。網站不能直接啟動未安裝的本機程式，因此不假裝下載按鈕能自動啟動 Bloomberg。

### 維運者：使用 repository 啟動

正式單券頁提供 [BQL API 預覽](https://creditbase02.github.io/rv-dashboard/bql.html) 入口；原有 `update.html` Excel 上傳、驗證及發布流程繼續保留。API 預覽只在頁面記憶體載入 schema v2，不會呼叫 `/publish/luac`、產生 PR 或替換公開快照。Excel 一致性驗收仍未通過，因此目前沒有 API 發布按鈕。

完成下方本機環境安裝後，在已登入 Bloomberg Terminal 的公司電腦執行：

```powershell
python scripts/start_bql_preview.py
```

啟動器使用本專案 `.venv-bql` 的 polars-bloomberg 環境，啟動僅限 loopback 的服務，並開啟附有隨機連線憑證的正式頁面。若之前的本機測試站仍開著，先在其終端按 Ctrl+C，釋放 8768。保持啟動器視窗開啟，結束時按 Ctrl+C。憑證在 URL fragment，不送到 GitHub Pages；不要分享帶憑證的完整網址。若瀏覽器要求本機網路權限，允許此站存取後按「檢查連線」。

啟動只檢查環境；每次明確按「取得一次 BQL 快照」才送一次完整查詢。沒有背景輪詢、排程、Excel 重刷或自動重試。失敗保留先前快照與資料日期。SDK／程序／頁面等待上限分別為 120／270／280 秒。遠端使用者也必須在自己的授權 Bloomberg 電腦啟動 bridge，網站伺服器不代抓 Terminal 資料。

### Python 相容範圍與自動選版

Windows x64 標準版 CPython 3.12、3.13、3.14 共用既有固定套件版本，不降版取數套件，也不改 BQL 查詢。Setup.cmd 優先沿用啟動包內已建立的相容環境，其次依序檢查 py launcher 的 3.12、3.13、3.14，最後檢查 PATH 的 python／python3；檢查只驗證版本與架構，不安裝套件或查行情。顯示選中的 Python 後，才建立隔離環境並安裝必要套件。

現有環境不相容時停止，請解壓縮到新資料夾再設定；不刪除或改寫原有環境。3.11 以下不支援目前 polars-bloomberg 0.6.0 的 Requires-Python >=3.12；不接受 32-bit、ARM64 原生版、PyPy 或 free-threaded Python。依據：[PyPI metadata](https://pypi.org/pypi/polars-bloomberg/0.6.0/json)、[Bloomberg 官方 wheel 索引](https://blpapi.bloomberg.com/repository/releases/python/simple/blpapi/)。

完整 CI 分別在 Windows 的三個 Python 版本實際建立環境、安裝固定套件、載入 SDK、處理合成 BQL 回應及執行 Setup.cmd。這些相容測試不連 Terminal、不查市場資料；帳號的 BQL 權限與 Excel 一致性仍沿用原本的獨立驗收。
