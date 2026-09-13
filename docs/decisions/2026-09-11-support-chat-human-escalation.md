# Support Chat 人工客服升級路徑

> Owner Decision：2026-09-11
> 關聯：#25、#319、PR #320

## 決策

Owner 選擇 **A：第一版人工客服採 Email 升級，不另外建立 Midao 客服管理後台。**

目前右下角 SupportChatWidget 已有 `/api/support-chat/ask` 的自助查詢能力，可回答目前系統確實查得到的 LINE 串接狀態、推播額度、方案／權益等資訊。當小幫手判定為不支援、或使用者主動要求人工協助時，應提供明確的「轉人工」入口，而不是猜答案。

第一版流程：

1. GUIDE／租戶使用者在 widget 送出人工客服問題。
2. 系統建立可持久化的 support case／conversation 紀錄，保存 tenant、送出者、問題內容與建立時間。
3. 同一次成功建立案件後，系統寄 Email 通知 Midao 平台客服信箱；Email 應包含可辨識租戶與聯絡資訊，但不得包含 secret、token 或其他受遮罩資料。
4. Midao 人員第一版直接使用既有 Email 工作流程回覆租戶，不建立新的 platform support inbox／客服管理後台頁。
5. 租戶可在 widget 看到自己送出的客服歷史，且只能看到自己的 tenant 資料。

## 第一版的狀態真實性

因為第一版沒有平台客服管理後台，也沒有可驗證的 inbound Email 回覆事件，所以系統**不得猜測或假造「客服已回覆／處理中／已解決」**。

第一版至少可誠實顯示：

- `已送出，等待人工回覆`：資料已成功持久化，且平台通知 Email 已成功交給寄信 provider 時可如此描述。
- 若 Email 通知失敗：案件本身仍可保留，但 UI 必須誠實顯示「已保存，但平台通知寄送失敗／待重試」，不得顯示已通知人工客服。

日後若建立平台客服後台、Email inbound webhook 或其他可驗證的人工作業事件，才可以擴充 `處理中／已回覆／已解決` 等狀態。不能只因時間經過或寄出一封通知信，就自行推斷人工客服已處理。

## 與現有小幫手的邊界

- `POST /api/support-chat/ask` 保留為自助狀態查詢，不與人工客服訊息／案件端點混成同一語意。
- 小幫手判不出來時不猜，應提供「轉人工」操作。
- 人工客服資料需持久化；不得只把使用者文字 append 在前端 state 後顯示成功。
- 租戶隔離必須由 server-side authorization 與 RLS／等價資料邊界雙重保護。
- Support case 不得成為平台讀取 tenant secrets 的繞道。

## 第一版不做

- 不建立新的 Midao 客服管理後台／客服收件匣。
- 不做即時真人聊天室或客服在線狀態。
- 不自動把所有 unsupported 問題送出；使用者必須明確按「轉人工／送出客服案件」。
- 不宣稱 Email provider accepted 等於對方已讀或已回覆。
- 不導入 Zendesk、Intercom 等第三方客服平台；未來有量再另行評估。

## 實作回併要求

#25 的 runtime implementation 應把本決策回併至 `docs/integration/04-API-CONTRACTS.md` 的 support-chat canonical 契約，並核對原站既有 `/api/support-chat/history`、`/message`、`/new-session`、`/status` 路徑後收斂最終 API 形狀。

實作時應同時完成：持久化客服案件／對話、平台通知 Email、租戶端歷史讀取、真實錯誤狀態與 tenant isolation 測試。若平台客服信箱 env 尚未設定，應列出具名缺項，不得硬編碼個人信箱。

本決策僅裁示產品流程。Runtime 程式、migration、Production DDL／DML、正式部署與真實外部寄信驗收仍依 repo 現行治理與 Owner gate 執行。
