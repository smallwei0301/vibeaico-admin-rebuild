# Owner Decision：MODEL_GOVERNANCE 與 PRODUCT_MAINLINE 雙軌

日期：2026-09-10
狀態：ACTIVE
追蹤：#339

## 決策

專案從本決策起固定分成兩種工作模式，所有新 Issue / PR 在建立時就必須分類，不得等施工後才補。

### 1. MODEL_GOVERNANCE

`WORKSTREAM: MODEL_GOVERNANCE`

涵蓋純模型與工程治理，例如：

- model routing / reviewer routing；
- Agent orchestration、WIP、lane、dual-Terra 規則；
- Final Risk guard 本身的治理；
- governance metrics / scoreboard / run evidence；
- PR lifecycle、治理型 CI 規則與 governance templates；
- 上述規則的測試與 canonical 文件。

執行方式固定為：

```text
GPT-5.6 Sol conversation/session
→ current truth
→ bounded governance implementation
→ source CI / regression tests
→ Sol final diff verification
→ merge / closeout
```

MODEL_GOVERNANCE：

- 不派 Terra；
- 不建立 Reserve Terra；
- 不做 dual-Terra；
- 不要求 Astra / Fable Final Risk；
- 不因為沒有 Astra/Fable attestation 阻塞；
- 不加入 Product Delivery Run 來製造產品產出數；
- 不宣稱使用者可見 Product shipped output。

Sol 對話模式就是此 workstream 的主導、施工與最終治理審核模式。仍必須有真實 diff、必要測試、CI 與 completion truth，並不是取消工程驗證。

### 2. PRODUCT_MAINLINE

`WORKSTREAM: PRODUCT_MAINLINE`

只要會改變以下任一項，就屬 Product 主線：

- 使用者可見後台／前台功能；
- API/runtime 行為；
- tenant data flow；
- schema / migration；
- payment / refund；
- LINE 或其他產品 provider 行為；
- Product deployment / Production 行為；
- 跨 repo 的產品契約。

PRODUCT_MAINLINE 繼續遵守既有 B+ Product delivery、TEST、Sol audit 與 Product Final Risk 規則。這份決策不降低 Product 安全門檻，也不構成任何 Production 操作授權。

## 混合範圍

一張工作若同時包含治理與 Product 變更：

1. 優先拆成兩張 Issue / PR，各自進正確 workstream。
2. 如果無法安全拆開，整張歸 `PRODUCT_MAINLINE`。
3. 不得把 Product runtime / schema / payment / LINE / deploy 變更標成 MODEL_GOVERNANCE 來避開 Product gate。

換句話說，MODEL_GOVERNANCE 是「純治理快速線」，不是「免審標籤」。

## Issue / PR 建立規則

每張新 Issue / PR 必須有且只有一個：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

或：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

空白、拼錯或第三種值都視為未分類。Delivery Slice 永遠預設為 `PRODUCT_MAINLINE`；Agent-discovered Issue 必須在建立時選擇 workstream。

既有 open Issue / PR 不要求改寫歷史，但在下一次被實際接手施工、rebuild、promote 或 closeout 前，要先依 current truth 補上 workstream 分類。

## 與舊 Final Risk 決策的關係

#332 / #334 / #335 / #336 建立的 Fable/Astra Final Risk、Agent-native attestation、changeDigest reuse 等規則仍保留給 `PRODUCT_MAINLINE`。

本決策只 supersede 一件事：**MODEL_GOVERNANCE 不再走 Astra/Fable Final Risk，也不再用 Terra 當治理 builder。**

舊文件若把所有治理 gate modification 一律導向 Astra/Fable，從本決策起只對 PRODUCT_MAINLINE 或不可拆的混合 Product scope 有效。

## 安全邊界

本決策不授權：

- Production DDL / DML / migration；
- manual Production promote / rollback；
- 真實 payment / refund；
- LINE webhook 切換；
- 顧客通知；
- 任何憑證外洩或把 secret 寫入 repo。
