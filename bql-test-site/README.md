# RV Lab：本機 BQL 單券測試站

在 repository 根目錄執行：

```powershell
python bql-test-site/serve.py
```

需要這台電腦已登入 Bloomberg，並完成 `.venv-bql` 的 `blpapi`、`polars-bloomberg` 安裝，見 `BQL_DIAGNOSTICS.md`。啟動器使用已完成本機單券及全量取數測試的 polars-bloomberg 路徑；不代表正式資料一致性已核准。它只綁定 loopback，自動開啟帶暫時連線憑證的本機頁面；不要分享該憑證 URL。啟動視窗按 Ctrl+C 可停止網站與 bridge。

頁面為 `http://127.0.0.1:8767/`，bridge 為 8768。兩個 port 都必須空閒；不會終止其他服務來騰出 port。`--no-open` 可僅啟動網站而不開啟瀏覽器。關閉 Terminal 或環境不可用時會顯示錯誤，不會改用其他來源。

- 載入頁面或「檢查連線」只讀取環境資訊，不發市場查詢。
- 每次「取得一次 BQL 快照」只執行一次完整 universe 查詢；不先抓單券，不排程、不輪詢、不重試。SDK 等待上限 120 秒、子程序總上限 270 秒。
- 資料僅經 token 與 Origin 保護的 `/preview` 回到本機頁面；只有 8767 的本機來源可以使用這個端點。預覽預設關閉，由啟動器明確啟用。
- 沿用原成分交集、BVAL BID、Convention Yield、BICS Level 1、網站現行 Peer Group mapping，以及既有 schema v2／品質旗標／LOWESS 與篩選模型。
- 期限 0Y–50Y，異常券預設排除於點位及曲線。使用者可切換 Yield／OAS、信評／產業／Peer Group、搜尋、曲線母體與排名。
- 僅做結構與數值檢查；畫面固定標示「未經正式 Excel 比對核准」。沒有登入、GitHub App 或發布功能。
- 成功資料僅存在頁面記憶體；沒有 localStorage、IndexedDB 或資料下載，也不寫入 Git、公開資產、日誌或部署包。取數失敗保留上一份快照與原日期，不假裝更新成功。

建置：`python bql-test-site/build.py`。輸出 `dist/` 被 Git 忽略；只包含程式與樣式，不包含任何市場快照。單券頁與模型由目前專案產生，正式 `bonds.html`／公開 JSON／Worker 不變。
