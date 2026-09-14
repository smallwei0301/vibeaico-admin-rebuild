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

## 不隨本 Issue 關閉的後續 —— 更正：**沒有後續**

本檔初版寫著：「#246 自己記著 #33 ③-2 以『永久留白，無 xlsx generator』為由留白，
該理由已失效，需回頭重評，屬 #33 範圍，已回報 Owner。」

**那是錯的。那一格在 2026-09-08 就已實作並合併**，比本次結案早六天：

- PR #285「feat(#33③): 匯出 Excel 真的按得到——預約補上 xlsx，庫存把既有分支接出來」
  `merged: true`、`2026-09-08T03:41:01Z`、`59e79f57…`
- #33 內文 §3 標題已是 `~~§3 ③-2 excel 分支~~ —— ✅ 2026-09-08 已完成`
- `src/app/api/export/bookings/[format]/route.ts:33` → `const SUPPORTED_FORMATS = ['csv', 'xlsx'] as const;`
- `tests/integration/api/export-bookings-xlsx.33.test.ts` 存在（8 個案例）

成因：我讀到 #246 內文「相關」段落的 `需回頭重評`，**直接當成現在仍待辦，沒查它是否已被處理**。
那句話寫於 #246 建立當天（2026-09-07），#285 隔天就做掉了，但 #246 內文沒有回填。

值得記下來的是：這與本檔下一節批評 scout 的錯誤**完全同型**——「從一個沒查證的前提，
推導出一個具體且聽起來確定的結論」。我一邊記錄 scout 第四次犯它，一邊在同一份文件裡
犯了一次。差別只在我在交付前自己查到了，而 scout 自評「不確定項：無」。

**教訓不是「scout 要更小心」，而是「Issue 內文裡的待辦敘述和 scout 的回報同屬未查證來源」**——
兩者都要對著當前倉庫狀態覆核，來源是人是模型都一樣。

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
