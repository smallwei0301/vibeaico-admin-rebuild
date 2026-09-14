# LUNA_CLOSURE sweep — Run `2026-09-14-product-delivery-r01` s07

- 執行時間：2026-09-14T11:46Z–11:57Z
- 起點：`origin/main` = `35e2e1a6`（PR #449 合併後）
- 委派：`claude-haiku-4-5`（scout 層，依 `CLAUDE.md` Lane 表）
- 結果：**1 個候選 → 已結案**（Issue #246）

## 結論

Issue **#246**（「匯出 Excel」三處假成功）已於 `2026-09-14T11:57:10Z` 以
`state_reason: completed` 關閉。驗收清單 10 項全勾、0 項未勾，且下列事實由 audit 層
在 `origin/main`（`35e2e1a6`）**自行實查**，非採信 scout 或 Issue 欄位：

- `package.json:38` 有 `exceljs@^4.4.0`
- `tests/integration/api/export-xlsx.246.test.ts`、`tests/unit/export-filename-truth.246.test.ts` 皆存在
- `inventory/[format]/route.ts:61`、`bookings/[format]/route.ts:39` 皆為「CSV 與 Excel」
- `src/server/xlsx.ts` 提供共用 `buildXlsx` / `xlsxResponse`
- `export/reports/[format]/route.ts` 確為五區塊營運報表（逐日 bookings/revenue、byService、byProduct），
  CSV 與 xlsx 共用同一份 `reportRows`——即 #250 承接的「顧客名單冒充營運報表」確已修復
- `npx vitest run tests/unit` 171 files / 2315 tests passed
- Issue #250 `closed`（`2026-09-07T11:20:29Z`）、PR #248 `merged`（`2cc90bfa…`）

**未重跑、採信既有紀錄者**：`test:integration` 與 Playwright E2E 的原始輸出
（ZIP 魔數 `50 4B 03 04`、exceljs 讀回表頭比對、E2E 檔名 `.csv`→`.xlsx`）。
本輪未動用 canonical TEST，故這一段是採信而非實測，已在結案留言中寫明界線。

## 不隨本 Issue 關閉的後續

#246 自己記著：#33 ③-2 先前以「永久留白，無 xlsx generator」為由留白，該理由已因
`src/server/xlsx.ts` 存在而失效，需回頭重評。屬 #33 範圍，已回報 Owner。

## scout 本輪的事實錯誤（第四次，同一個模式）

委派訊息已明列三條硬規則並要求附指令輸出，scout 也自評「不確定項：無」。實查後仍有三處錯：

| scout 宣稱 | 實際 | 查證 |
|---|---|---|
| #250 於 **2026-09-14** 關閉 | `2026-09-07T11:20:29Z` | `gh api .../issues/250 --jq .closed_at` |
| **15** 個 open PR | **14** 個（它自己只列出 14 個編號） | `gh api ".../pulls?state=open&per_page=100" --jq length` |
| open Issue 清單為 `#1, #6, #8–26, #31–50, #66, #104, #118, #120, #228, #238, #246, #359, #396, #402, #447` | 清單漏了 #218、#221，而它在下一節又逐項討論了這兩個 | `gh api .../issues/218`、`.../221` 皆 `open` |

模式與前三次相同：**從一個沒查證的前提，推導出一個具體且聽起來確定的結論**，而且
「自評無不確定項」本身就是那個模式的一部分——它對自己的錯誤同樣有信心。

值得注意的是**候選判定本身是對的**。錯的全是周邊計數與日期。這正好說明為什麼
scout 層的產出必須逐項覆核而不是抽查：錯誤不集中在結論，而散在支撐結論的事實裡。

已累計第四次，`CLAUDE.md` 的委派規則需要的不是再加一條告誡，而是**把「附上指令輸出」
變成回報格式的必填欄位**——目前它是散文裡的一句要求，scout 可以宣稱遵守而不實際附上。
