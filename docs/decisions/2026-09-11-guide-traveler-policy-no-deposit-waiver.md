# GUIDE 旅客層級政策：第一版不提供熟客免訂金

> Owner Decision：2026-09-11
> 關聯：#44、#12、#41、`docs/integration/19-GUIDE-PRODUCT-EXPERIENCE.md`、`docs/integration/18-GUIDE-COMMERCE-LIFECYCLE.md`

## 決策

Owner 選擇 **B：第一版不提供 `FORCE_NO_DEPOSIT`／「可信熟客免訂金」這類旅客層級 override。**

旅客層級風險政策第一版只允許比 TripPlan／付款政策**更嚴格或改成人工確認**，不得把原方案既有的付款安全條件放寬。

允許的第一版政策維持：

- `DEFAULT`：沿用方案原本政策。
- `FORCE_DEPOSIT`：提高風險控管，要求訂金；不得低於既有方案的強制付款安全要求。
- `REQUEST_ONLY`：改為先申請、由導遊確認後再進入後續流程。
- `BLOCK_SELF_SERVICE`：禁止旅客自行下單；導遊仍可在後台代建，且需保留來源／操作者。

第一版**不新增**：

- `FORCE_NO_DEPOSIT`
- `WAIVE_DEPOSIT`
- `TRUSTED_NO_DEPOSIT`
- 或任何等價的「針對單一熟客，自動取消原方案訂金／預付款要求」能力。

## 優先順序

旅客政策仍可以加強 Plan 的一般規則，但不能繞過下列邊界：

1. tenant 停業／功能不可用；
2. 名額不足；
3. 導遊／人員不可履約或時間衝突；
4. provider／付款安全要求；
5. 成交時已凍結的訂單付款 snapshot。

若方案本身要求訂金或全額預付，`DEFAULT` 必須照原規則；其他旅客層級政策可以改成更嚴格的付款／確認流程，但不能把應收訂金自動降為 0。

## 熟客特殊處理

導遊仍可在真有業務需要時，透過既有的人工代建／人工例外流程處理個案，但第一版不把「熟客」變成一個可永久自動放寬付款規則的旅客政策。

任何人工例外若會改變已建立訂單的應收／已收／退款事實，必須走既有可稽核的訂單／付款／退款流程；不得只改前端標籤或直接覆寫成交 snapshot 後宣稱免訂金。

## UI 原則

旅客詳情的履約風險政策選項第一版不得顯示「熟客免訂金」或等價開關。可以保留「熟客」作為 tenant-private（租戶私有）標籤／備註，但它只是資訊，不直接修改付款規則。

這能避免「熟客」標籤與付款安全混成同一件事，也避免工作人員誤點後讓本來要求訂金的行程無意間變成零預收。

## 實作回併要求

#44 的 runtime implementation 應將此決策回併至 GUIDE 旅客風險／付款政策 canonical：

- policy enum／schema 不得加入 `FORCE_NO_DEPOSIT` 或同義值；
- resolver 測試需證明旅客 override 只能維持或加嚴付款要求，不得放寬；
- UI／API 契約與測試需鎖住不存在「熟客免訂金」入口；
- 若未來 Owner 要開放此能力，必須另做新的產品決策，不能由 Agent 自行新增。

本決策只裁示產品語意。Runtime 程式、migration、TEST／Production DDL、正式部署與真實付款流程仍依 repo 現行治理與 Owner gate 執行。
