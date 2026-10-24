RV Dashboard — Bloomberg BQL Windows 啟動器

1. 將 ZIP 完整解壓縮到可寫入的資料夾，不要直接在 ZIP 內執行。
2. 此工具需要 Windows、Python 3.12 64-bit、已登入的 Bloomberg Terminal，及帳號的 BQL／行情權限。
   Python：https://www.python.org/downloads/windows/（公司電腦可請 IT 安裝 Python 3.12 64-bit）
3. 首次雙擊 Setup.cmd：建立本資料夾內的 Python 環境，從 Bloomberg 官方來源安裝 blpapi，從 PyPI 安裝 polars-bloomberg 與 polars。
   公司網路若禁止下載套件，請 IT 協助；工具不更改系統安全政策，也不要求管理員權限。
4. 每次使用雙擊 Start.cmd：只檢查環境及下載網站公開 Peer Group mapping，再開啟附有本次連線憑證的正式頁面。
5. 保持命令視窗開啟。網頁顯示「本機服務就緒」後，按「取得一次 BQL 快照」才查行情。
6. 結束時在命令視窗按 Ctrl+C。若埠 8768 已被占用，先關閉先前啟動器，再執行一次 Start.cmd。

瀏覽器若詢問本機網路存取權限，允許此站連線。不要分享帶有 bbg-token 的完整網址。
不會重刷 Excel、背景更新、自動重試或發布 API 快照；原有 Excel 更新通路繼續保留。
本包不附帶 Bloomberg SDK 二進位檔、行情快照、Excel、私人資料或憑證。
polars-bloomberg 為第三方介面；帳號與公司用途是否支援本機 BQL，仍需向 Bloomberg 確認。
