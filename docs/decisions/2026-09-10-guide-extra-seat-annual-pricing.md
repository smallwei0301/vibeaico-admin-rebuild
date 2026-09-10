# GUIDE 超額導遊席次年繳

> Owner Decision：2026-09-10
> 關聯：#120、#48
> 定價 canonical：`docs/decisions/2026-09-03-guide-saas-pricing.md`

## 決策

Owner 選擇：**A，團隊版超過內含 5 位後的額外 active+bookable 導遊席次，年繳同樣採「付 10 個月、使用 12 個月（送 2 個月）」**。

因此：

- 額外席次月繳：NT$150／月／席。
- 額外席次年繳：NT$1,500／年／席。
- 年繳計算：NT$150 × 10 = NT$1,500，席次權益期間 12 個月。
- 主方案與額外席次使用同一套 SaaS entitlement（方案權益）與 active+bookable 席次真相，不建立第二套年繳席次模型。
- 停用／歷史導遊不占付費席次。
- 已有團次、歷史指派、訂單與業績不得因席次下降而刪除。

## 邊界

本決策只拍板額外席次的月／年價格與年繳折扣。

以下仍待 subscription billing（正式訂閱計費）施工前另行定義：

- 年繳期間中途增加席次的按比例補款方式。
- 年繳期間中途減少席次是否折抵到下期。
- 月繳／年繳互轉、升降級、取消與退款規則。

未授權 Production 訂閱扣款、正式價格頁發布、Production migration 或 runtime main merge。
