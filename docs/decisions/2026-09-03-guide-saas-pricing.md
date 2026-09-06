# GUIDE SaaS 定價決策

> Owner Decision：2026-09-03
> 關聯：#120、#118、#48

## 1. 永久體驗版

Owner 已裁示：

- NT$0。
- 不採 14／30 天倒數失效。
- 1 位 active+bookable 導遊。
- 累積 30 張有效訂單。
- 第 30 張有效訂單可以正常成立；第 31 張起停止建立新的免費有效訂單。
- 已成立訂單、付款、退款、通知、安全、資料查看與匯出不因額度達上限而被鎖住。
- 30 張為累積門檻，不按月重置；曾經真正成立的有效訂單不因後續取消／退款而自動回補免費額度。

## 2. 個人版

Owner 選擇：**A，NT$399／月。**

個人版定位：

- 1 位 active+bookable 導遊。
- 完整 GUIDE 日常 SaaS 能力。
- 不再對基本 GUIDE 報表、必要 availability、基本交易 Email／Telegram、退款處理等收第二次單項功能費。
- Midao 付費曝光、額外 LINE Push、AI 額外用量、平台代建／營運服務仍屬獨立 add-on 或服務。

月費 NT$399 與目前 VibeAI 輕量方案價格階梯保持一致，但 GUIDE 的產品能力按旅遊領域重新定義，不代表沿用舊 Feature Store 的單項功能組合。

## 3. 團隊版

Owner 補充裁示：**NT$799／月，含 5 位 active+bookable 導遊。**

團隊版定位：

- 每個 GUIDE tenant 最多可同時啟用 5 位 active+bookable 導遊，包含 owner 本人；停用人員與歷史人員不占新席次。
- 仍沿用既有「不做 SOLO／TEAM 開關」原則：系統依目前 active+bookable 導遊數自動切換 1 人或多人協作 UI。
- 包含 PRIMARY／ASSISTANT 團次指派、團隊 availability／防撞、團隊篩選、C+ 業績歸屬與團隊報表等多人協作能力。
- 歷史導遊、訂單、團次與業績不因降級或停用而消失。
- 超過 5 位時的額外席次方案另行裁示；不得自行套用「每位 NT$399」或其他未決價格。
- Midao 付費曝光、額外 LINE Push、AI 額外用量、平台代建／營運服務仍屬獨立 add-on 或服務。

因此目前 GUIDE SaaS 月費階梯為：

```text
永久體驗版  NT$0      1 位導遊，累積 30 張有效訂單
個人版      NT$399/月  1 位導遊，完整個人日常能力
團隊版      NT$799/月  含 5 位導遊，完整多人協作能力
```

## 4. 尚待 Owner 決策

- 年繳折扣。
- 超過 5 位後的額外導遊席次價格／更高階團隊方案。
- AI／LINE 額外額度價格。
- 舊點數／Feature Store 訂閱如何折抵或遷移。
- Production subscription billing 正式啟用。

## 5. 發布界線

本文件只定產品與價格規格。未授權 Production 訂閱扣款、正式價格頁發布、Production migration 或會觸發正式環境行為的 runtime main merge。
