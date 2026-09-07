# 產品改善：#8 行程列表操作持久化

狀態：READY_FOR_PROMOTION（source-only；尚未合併或出貨）。

基準 main：629f41c8a72f8efb74030c1e67702b18535cd52f。  
分支：product/issue-8-trip-list-persistence-v1。

## 修正範圍

/tenant/trips 原本會從真實 API 載入列表，但發布、下架、申請 Midao、刪除四個操作只修改頁面記憶體；重新整理後會恢復舊狀態。這次只接既有 src/services/tours.ts 的四個 service：

- publishTrip
- requestMidaoListing
- deleteTrip
- 既有 listTrips 的重新讀取

真實模式先等待 API 成功，再重新讀取列表；API 失敗時顯示錯誤，不顯示成功訊息。Mock 模式保留本地 UI 適配，方便沒有後端的畫面預覽。

未修改 tour-domain API、migration、Supabase policy、付款、通知或另一代理擁有的檔案。

## 驗證

- tests/unit/trips-list-persistence.8.test.ts 鎖定四個操作的 service 接線及成功後重新讀取。
- 尚未執行 shared TEST、Production DDL/DML、E2E 或正式部署。
- 最後 Sol/Astra 審查待升格後依 exact head 執行。
