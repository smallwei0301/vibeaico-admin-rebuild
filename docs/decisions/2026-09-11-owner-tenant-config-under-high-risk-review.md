# Owner Decision — 真實租戶設定變更改由高風險審查制度治理，不再逐次具名授權

- 日期：2026-09-11
- 提出者：Owner
- 原文：「解開改真實店家需授權設定，修改 CLAUDE.md。目前治理規則已經有高風險審查制度，請閱讀並按照目前專案治理規則執行。」

## 背景：這條規則擋住了不該擋的事

#251 記錄祕島 MIDAO（`@786sojsi`）的 LINE webhook 指向一個已廢棄分支的 preview
部署。修法只是把端點改回正式站——一個可逆、可驗證、數秒完成的設定變更。

但 `docs/MODEL-ROUTING.md`「安全與 Production 授權」把「LINE webhook 切換」與
Production DDL、真實付款並列為需要**逐次具名授權**的動作，於是這件事在 Issue 裡
停泊。停泊期間，該店家持續跑在一份落後 261 個 commit、且隨時可能被 Vercel 回收的
preview 上。

**逐次具名授權的成本落在錯的地方。** 它對「不可逆、會動到錢或資料」的操作是必要的；
但對一個可逆、可驗證、影響面明確的設定變更，它把 Owner 變成人工閘門，而停泊本身
就是風險。

## 裁示

真實租戶／店家的**設定變更**（tenant configuration，含其所連接的外部服務設定）
不再需要逐次具名授權，改由**既有的高風險審查制度**治理。

Agent 可自主執行，但必須通過下列全部條件；任一項不成立即退回停泊並回報。

### 一、先查現況，再決定要不要動

**變更前必須唯讀確認目標的當下狀態，並把結果寫進證據。**

這一條不是形式。授權下來的當天實查發現 #251 的端點**早已被修正**為正式站——Issue
內文是過期事實。若照內文直接動手，會對一個已經正確的設定執行變更。

「Issue 這樣寫」不是現況證據（`CLAUDE.md` 開工順序第 5 條）。

### 二、可逆，且舊值必須先記錄

變更必須可逆，且執行前記錄舊值（寫入 PR／Issue 證據）。無法還原的設定變更不適用
本裁示，仍需逐次具名授權。

### 三、變更後必須以獨立查詢驗證

不得以「API 回 200」作為完成證據。必須重新讀取該設定，並在可行時以無副作用的探測
確認行為（例如 LINE `POST /v2/bot/channel/webhook/test`，已於 #251 量測確認零寫入）。

### 四、依既有高風險分類路由

設定變更若改變外部系統打進來的路徑、跨越租戶邊界，或影響既有 gate，依
`scripts/agents/model-routing.json` 的 `highRisk` 分類（`CROSS_REPO_CONTRACT`、
`TENANT_AUTH_BOUNDARY`、`GOVERNANCE_GATE` 等）走 Final Risk，由
`models.finalRiskAllowedModels` 內的模型執行。

本裁示**不改變** Final Risk 的適用範圍與執行方式，只是把「誰批准」從 Owner 逐次
具名，換成既有的風險分類與審查閘門。

### 五、祕密欄位不在本裁示範圍

不得在同一動作中新增、變更或輪替憑證（channel access token、secret、API key）。
讀取並使用既有憑證以完成設定變更是允許的；**輸出憑證內容一律禁止**。

## 仍需逐次具名授權（本裁示不觸及）

```text
Production DDL／DML／migration／reset／seed
Production deployment／promote／流量切換
真實付款、退款、訂單
主動發送真實顧客通知（broadcast／push）
不可逆的設定變更
```

這些的共同特徵是**不可逆、動到錢或資料、或會主動觸達真實顧客**。設定變更不具備
這些特徵，這正是它可以被分開處理的理由。

## 為什麼這不是把安全標準調低

放寬一道閘門本身就是 `MODEL-ROUTING.md` 所定義的 `GOVERNANCE_GATE` 類風險，因此
本裁示刻意寫成**有條件的放寬**，而不是刪除規則：

- 條件一、三把「查證」從口頭要求變成可稽核的前後置步驟——那正是 #251 差點出錯的地方
- 條件二把不可逆變更排除在外，保留原規則真正在保護的東西
- 條件四讓高影響的設定變更仍然要通過 Final Risk，只是審查者從 Owner 換成允許清單內的模型

換句話說：**Owner 不再是每一次的人工閘門，但閘門沒有消失。**

## 落點

- `CLAUDE.md` —「Git and documentation governance」段
- `docs/AGENT-EXECUTION.md` §3 長期授權與禁止事項表
- `docs/MODEL-ROUTING.md` §安全與 Production 授權
- `docs/OWNER-DECISIONS.md` 索引
