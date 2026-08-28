# 2026-08-28 Owner Decision — GUIDE 租戶自有金流憑證必須端到端驗證

## 決策

- 每個 GUIDE tenant / 工作室使用**自己的** merchant credentials 收款；多導遊團隊中的 PRIMARY / ASSISTANT 只是履約人員，不切換收款商戶。
- `tenant_payment_methods` 的 merchant id / key / iv 必須加密保存、API 遮罩；任何 checkout/callback 都不得 fallback 到平台共用 merchant key。
- `test-connection` 只代表連線／憑證初步驗證，不足以把線上金流標示為「可正式收款」。
- 線上金流至少要有兩階段 verification：
  1. connection verified：使用該 tenant 解密後的 credentials 通過 provider 驗證。
  2. e2e verified：使用同一 tenant 的同一 payment_method 完成小額測試 checkout → provider → callback → 更新正確測試 TourOrder 的完整閉環。
- 只要 merchant/provider/secret 任一關鍵欄位修改，就清除既有 verification；未重新完整驗證前不得對旅客啟用線上收款。
- callback 必須先解析 tenant/payment_method，再使用那一組 tenant credentials 驗簽；Tenant A 的 key 絕不能更新 Tenant B 的 order。

## Canonical

完整規格：`docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md` §8。
施工歸屬：#9 負責 credentials / verification 狀態與設定 UI，#12 負責真正 checkout / callback 的 tenant-key E2E 證據。