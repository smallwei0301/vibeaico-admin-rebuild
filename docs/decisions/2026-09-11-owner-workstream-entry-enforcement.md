# Owner Decision：所有新 Issue / PR 在入口就分成兩個 Workstream

日期：2026-09-11
狀態：ACTIVE
追蹤：#357

## Owner 裁示

`vibeaico-admin-rebuild` 後續所有新 Issue / PR，在建立時就必須屬於且只屬於以下一種：

```text
MODEL_GOVERNANCE
PRODUCT_MAINLINE
```

**工作治理／工程治理明確歸 `MODEL_GOVERNANCE`。** 這不是第三種分類。

工作治理包含但不限於：

- Agent 派工、orchestration、工作流程；
- WIP、lane、dual-Terra、多 Agent 規則；
- PR lifecycle、Issue 流程、closeout；
- 治理型 CI、Guard、Hook、Template；
- model / reviewer routing；
- metrics、scoreboard、run evidence、completion truth；
- 上述治理規則的文件與 regression tests。

`PRODUCT_MAINLINE` 維持既有定義：使用者可見功能、API/runtime、tenant data、schema/migration、payment/refund、LINE/provider、Product deployment、跨 repo Product contract。

## 入口規則

1. GitHub UI 不開放 blank Issue。人工建立治理工作用「模型／工作治理」表單；產品交付用 Product 表單。
2. Agent-discovered Issue 仍必須在建立時選擇 Workstream。
3. API 或其他入口若產生缺少／拼錯 Workstream 的 Issue，不得進治理快速線；先標記 incomplete，並 fail-safe 視為 `PRODUCT_MAINLINE`，直到修正。
4. 所有新 PR，包含 Draft，都要執行 Workstream Classification。缺少、拼錯或把 Product scope 偽裝成 `MODEL_GOVERNANCE` 都必須失敗。
5. PR / Issue 介面上維持唯一 workstream label，讓 Owner 可直接看出它屬於哪一條線。
6. 在既有 workstream `effectiveAt` 之前就建立、且尚未補分類的 legacy PR，維持既有 grandfathered 規則；本決策不因單純 edit / synchronize 把歷史 PR 追溯改寫成新制度。若 legacy PR 主動補上合法 WORKSTREAM，則從該內容開始依新分類執行。

## 混合範圍

同一張工作若同時包含治理與 Product：

1. 優先拆成兩張；
2. 無法安全拆時整張歸 `PRODUCT_MAINLINE`；
3. `MODEL_GOVERNANCE` 不得成為繞過 Product TEST、Final Risk 或 Production 授權的捷徑。

## 與 2026-09-10 決策的關係

本決策不改變 `docs/decisions/2026-09-10-owner-two-workstream-sol-governance.md` 的兩條 workstream 定義，只把「建立時就要分流」做成可執行入口與 fail-safe 守門，並再次明確確認：**工作治理屬 MODEL_GOVERNANCE。**

## 不包含的授權

本決策不授權 Production DDL/DML/migration、deploy/promote/rollback、真實 payment/refund、LINE webhook 切換、顧客通知或任何 secret 寫入 repo。
