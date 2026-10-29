RV Dashboard — Bloomberg BQL Windows 啟動器

1. 將 ZIP 完整解壓縮到可寫入的資料夾，不要直接在 ZIP 內執行。
2. 此工具需要 Windows、標準版 64 位元 CPython 3.12、3.13 或 3.14、已登入的 Bloomberg Terminal，及帳號的 BQL／行情權限。
   Python：https://www.python.org/downloads/windows/（公司電腦可請 IT 安裝標準版 64 位元 CPython 3.12、3.13 或 3.14）
3. Setup.cmd 會優先沿用本資料夾的相容環境，再自動尋找系統預設及已安裝的 3.14、3.13、3.12；不要求更換預設 Python，也不會安裝其他 Python。
   Python 3.11 以下、32 位元、ARM64 原生版、PyPy 與 free-threaded 版本不支援。
   若舊環境損壞或不相容，可執行 Repair.cmd；原環境會保留在本資料夾的備份目錄。
   首次雙擊 Setup.cmd：建立本資料夾內的 Python 環境，從 Bloomberg 官方來源安裝 blpapi，從 PyPI 安裝 polars-bloomberg 與 polars。
   公司網路若禁止下載套件，請 IT 協助；工具不更改系統安全政策，也不要求管理員權限。
4. 每次使用雙擊 Start.cmd：只檢查環境及下載網站公開 Peer Group mapping，再開啟附有本次連線憑證的正式頁面。
5. 保持命令視窗開啟。網頁顯示「本機服務就緒」後，按「取得一次 BQL 快照」才查行情。
6. 電腦重開機後只需登入 Bloomberg，再按 Start.cmd，不必重新 Setup。重複按 Start 會重用同資料夾已驗證的連線。
7. 結束時按 Ctrl+C 或關閉原啟動器視窗，bridge 會隨之停止；不要關閉後仍期待網頁可繼續取數。
8. 連線失效時執行 Reset.cmd：停止同資料夾已驗證的 bridge，再建立新連線與 token，保留套件。舊網頁請改用新開啟的頁面。
9. 安裝損壞時執行 Repair.cmd，確認後備份舊環境並重新安裝套件；需要網路及相容的系統 Python。若修復失敗，備份仍保留。
10. 若 8768 由舊版、另一資料夾的 launcher 或其他程式占用，工具不會自動終止它。先在原啟動器按 Ctrl+C；舊版殘留無法關閉時可重新開機。

本機 .bql-session.json 保存連線 token，勿分享或上傳。只重用能通過 token 驗證且標示為 launcher-managed 的服務。

瀏覽器若詢問本機網路存取權限，允許此站連線。不要分享帶有 bbg-token 的完整網址。
不會重刷 Excel、背景更新、自動重試或發布 API 快照；原有 Excel 更新通路繼續保留。
本包不附帶 Bloomberg SDK 二進位檔、行情快照、Excel、私人資料或憑證。
polars-bloomberg 為第三方介面；帳號與公司用途是否支援本機 BQL，仍需向 Bloomberg 確認。
