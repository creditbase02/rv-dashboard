# RV Dashboard

獨立的公開 RV 相對價值網站。正式網址：<https://creditbase02.github.io/rv-dashboard/>。

```sh
python3 publish.py --build-only
python3 -m unittest discover -s tests -v
pnpm run test:model
pnpm run test:worker
pnpm run check:worker
python3 -m http.server 8766 --directory public
pnpm run test:browser -- http://127.0.0.1:8766/
```

首頁保留既有 RV 圖表；`bonds.html` 提供「單券相對價值比較表」，包括 Yield／OAS 點位、穩健 LOWESS 信評曲線、篩選與排名表，第二層篩選可在產業與 Peer Group 之間切換（切換時清除另一邊的勾選）；`supply.html` 提供 IG Primary Supply 的 YTD／MTD、月度與 Industry／Rating／Tenor／Peer Group 分析。

原始 Excel、PPT、PDF 與私人稽核資料不得加入 Git。公開端只保存通過嚴格驗證的 RV、LUAC 與 Supply 聚合 JSON。

網站的「更新資料」頁會直接在瀏覽器記憶體中解析 RV 四份 Excel、BICS Level 1 的 LUAC 純值／單一 BQL 快取 workbook，或獨立 Supply workbook，只把通過嚴格驗證的公開 JSON 傳給更新服務。Peer Group Excel 是選填的共用欄位，未選取時 LUAC 與 Supply 各自沿用正式站現行 mapping。三種資料有各自的發布開關、branch、label 與單檔 diff 防護。

完整維運流程見 `SITE_OPERATIONS.md`。

單券 BQL 網頁一鍵取數的唯讀可行性診斷，見 [BQL_DIAGNOSTICS.md](BQL_DIAGNOSTICS.md)。需公司 Bloomberg 環境實測，尚未接正式 API 發布。

正式單券頁另提供 [BQL API 預覽](https://creditbase02.github.io/rv-dashboard/bql.html)：在公司電腦執行 `python scripts/start_bql_preview.py` 開啟連線頁面，每次按鈕只抓一次。原有 Excel 更新與發布保留；API 快照僅供記憶體內預覽，一致性驗收完成前不覆蓋正式資料。

獨立的 [本機 BQL 單券測試站](bql-test-site/README.md)：執行 `python bql-test-site/serve.py`，每次按鈕只取得一次 API 快照，提供單券圖表與篩選；不發布或覆蓋正式資料，不重刷 Excel。
