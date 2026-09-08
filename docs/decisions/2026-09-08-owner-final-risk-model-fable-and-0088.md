# Owner 裁示：最後風險評估改由 Fable 執行 ＋ 授權 `0088` 套用正式庫

- 日期：2026-09-08
- 相關 Issue／PR：#209、#271、#280、#218、#8（#8-B）
- 授權形式：Owner 於本輪對三個具名問題各自作答（逐次具名，非概括授權）

---

## 一、最後風險評估的模型改為 Fable

**Owner 原文**：「在目前 anthropic 環境，請把 astra 改為 Fable，並記錄到你 claud.md 中」

### 決定內容

`scripts/agents/model-routing.json` 的 `models.finalRisk` 由 `gpt-6-astra` 改為
`claude-fable-5-1`，`version` 同步為 `2026-09-08.1`。實作於 PR #284。

### 為什麼

`docs/MODEL-ROUTING.md` 有兩條各自都正確的規則：

1. 高風險 PR 必須有一筆可信的最後評估。
2. 「缺實際模型證據不能使用 OPERATOR_ATTESTED」。

但這個執行環境**沒有 GPT-6 Astra 的存取管道**。兩條相加的結果，是每一支高風險
PR 都永久停在 `ASTRA_PENDING`——這道閘門從「擋住未經審查的高風險變更」退化成
「擋住全部高風險變更」，不再能區分「還沒審」與「審不了」。

裁示當下就有兩支卡在這裡，兩支的程式與測試都是綠的：

| PR | 內容 | guard 唯一的錯誤 |
|---|---|---|
| #271 | #8-B 旅遊訂單 | `No trusted Astra attestation for this head` |
| #280 | #218 點數折抵原子化 | 同上 |

**改的是「哪一個模型」，不是「證據要不要是真的」。** 指向一個這個環境真的叫得
到的模型，才能讓 attestation 對應到一次真實的執行。

### 邊界（哪些沒有改）

- **「Astra」保留為這道關卡的名稱。** `ASTRA_RISK` / `ASTRA_RATIONALE` /
  `ASTRA_TEST_BASELINE` / `ASTRA_SCHEMA_BASELINE`、` ```astra-review ` 區塊、
  guard 的訊息文字全部不動——那些名字已經寫進既有 PR body、workflow 與已存在的
  review 紀錄，改名會讓歷史紀錄對不上。**Astra ＝ 關卡；Fable ＝ 目前執行這道
  關卡的模型。**
- **`highRisk` 清單與 `sensitivePaths` 一字未動。** 什麼算高風險沒有放寬。
- **代填 attestation 仍然禁止。** 規則改的是模型 ID，不是證據標準。
- 模型 ID **只維護在 `model-routing.json`** 一處；guard 的單元測試是從那裡讀值
  再組 attestation 的，所以改設定後仍全綠，這同時證明沒有第二處寫死。

### 已知的導入問題（先有雞或先有蛋）

PR #284 自己動到 `scripts/agents/`（敏感路徑）且屬 `GOVERNANCE_GATE`，因此舊政策
會要求它附一筆 **GPT-6 Astra** attestation——也就是它要改掉的那個東西。guard 一律
checkout 預設分支，讀的是 `main` 上的舊設定。

`docs/MODEL-ROUTING.md` 原文已預期此情境（「初次安裝本規則的 PR 仍由舊 main
檢查器執行」）。#284 的 `Agent WIP Policy` 因此預期為紅，**該紅不代表內容有問題**；
放行方式需 Owner 以具寫入權限的身分決定。本 lane 不會為了讓它變綠而代填。

---

## 二、授權 `0088` 套用正式庫

**Owner 選項原文**：「授權 0088 套用正式庫」

### 授權範圍

| migration | 來源 | 內容 |
|---|---|---|
| `0088_issue_8b_tour_order_rpc_acl.sql` | PR #271（**合併後才套用**） | 對 `reserve_seats` / `release_seats` / `create_tour_order` / `cancel_tour_order` 四支 SECURITY DEFINER RPC：`revoke all … from public`、再撤 `anon` / `authenticated`、只 `grant execute … to service_role` |

**這是逐次具名授權，只涵蓋 `0088`、只涵蓋正式庫 `egehnijjpgijmccagxac`，不構成
後續 Production DDL／DML／部署的概括授權。**

### 為什麼需要

`0087` 原本只寫 `revoke … from anon, authenticated`。這不夠：**PostgreSQL 對新建
函式預設就 grant EXECUTE 給 `PUBLIC`**，而 `anon` / `authenticated` 都是 PUBLIC
的成員——那條預設授權讓瀏覽器仍然叫得到這四支繞過 RLS 的函式。

本機 PostgreSQL 16 實測：

| 情境 | `has_function_privilege('anon', …, 'EXECUTE')` |
|---|---|
| 只 `revoke … from anon, authenticated` | **true — 側門開著** |
| 再加 `revoke all … from public` | false |

特別難察覺的是：只撤兩個角色時 `pg_proc.proacl` 會維持 `NULL`（＝預設，PUBLIC
有權），而「什麼都沒有」很容易被讀成「乾淨」。已記為 PB-028。

### 執行順序（依 #197）

1. #271 通過最後風險評估並合併進 `main`。
2. **從 merged `main`** 取 `0087` 與 `0088` 的原文套用正式庫（不從分支取）。
3. 套用後以唯讀查詢核實：四支函式的 `has_function_privilege` 對 `anon` /
   `authenticated` 皆為 `false`、對 `service_role` 為 `true`，且 `proacl` 有明確
   條目而非 `NULL`；前後對照一併附回 #8 / #271。

---

## 三、未獲授權、仍然擋住的事項

以下兩項在本輪**沒有**取得授權或憑證，維持原狀：

| 事項 | 狀態 |
|---|---|
| `trips` / `trip_plans` 在 repo 與正式庫「同名但形狀不相容」的修法方向 | Owner 要求先提供白話說明再裁決；在裁決前**不碰這兩張表的任一側** |
| #26 段二 OAuth 所需的 Google OAuth 憑證與「平台的」LINE Login channel | 未提供，#26 段二維持擱置（段一已完成：兩顆按鈕 disabled ＋ 誠實狀態文案，無 404） |
