# 2026-08-28 Owner Decision — 免費通知基礎通道與可靠送達

## 決策

- Email + Telegram 的**基本交易／營運事件通知**是免費方案 baseline，不要求購買額外 feature。
- Telegram 仍需使用者完成 bot 綁定；未綁定屬 `NOT_CONFIGURED`，不是 provider failure。
- LINE 主動 Push 繼續依 LINE 額度／既有 feature 規則，不因本決策變成無限免費。
- 重要通知全面導向 transactional outbox + per-channel delivery ledger，必須可追蹤、可重試、可稽核；不再接受「fire-and-forget 後只寫 console」作為完整通知設計。
- 平台 Owner 每日固定收到前 24 小時 notification health digest，Email + Telegram 雙通道嘗試，並把 digest 本身保存於 DB。
- 只能宣稱 provider 能證明的狀態：Email accepted 不等於 inbox delivered；Telegram 200 不等於已讀。

## 原因

通知失敗不應改壞訂單主交易，但也不能因不阻塞主流程就變成不可觀測。舊 `tour-platform` 已有 Email + Telegram 多通道與 Telegram 綁定的成功經驗；新後台應保留其產品概念，改用更完整的 outbox/delivery ledger 收斂重試與稽核。

## Canonical

完整架構與驗收：`docs/integration/17-NOTIFICATION-DELIVERY.md`。

本決策明確覆蓋 `09-FEATURE-STORE.md` 舊有「基本 EMAIL_NOTIFICATION 一律付費」的衝突語意；實作者必須在對應施工 Issue 中同步整理 catalog / i18n / feature gate，不能同時留下兩種說法。