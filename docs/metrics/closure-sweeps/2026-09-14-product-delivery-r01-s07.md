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

---

## s07 補充：scout 漏列的 #218 其實是第二個結案候選

scout 的 open Issue 清單漏了 #218（見上表第三列）。補查後發現**那個漏列是有代價的**：
#218 的驗收 9 項中 8 項已勾，唯一未勾的第 9 項，其阻擋理由在六天前就已消失。

#218 第 9 格的原話：

> **這一格不打勾的理由**：`0090` **尚未套用正式庫**，也**尚未套用 canonical 共用 TEST**。

### 實查（唯讀，2026-09-14）

| 查核 | 環境 | 結果 |
|---|---|---|
| `0090_atomic_booking_points_redemption` ledger row | 正式庫 `egehnijjpgijmccagxac` | **存在**，`version 20260908134502` |
| 同上 | canonical TEST `nmwhwngojosmagjuvxol` | **存在**，`version 20260908132012` |
| `public.redeem_booking_points` 實體 | 正式庫 | **存在**，`(p_tenant uuid, p_booking uuid, p_points integer)`、`prosecdef=true`、plpgsql |
| `0093_booking_points_status_guard` ledger row | 正式庫 | **存在** |
| 該 guard 是否真的在**線上函式本體**裡 | 正式庫 | **是**：`pg_get_functiondef` 含 `not in ('PENDING', 'CONFIRMED')` |

依 PB-027／PB-037，ledger row 只證明「有人記了一筆」，所以上面**同時查了物件本身與函式本體**，
不只查檔名。#218 順帶產生的 #291（已完成／已取消的預約仍可折抵點數）亦已 `closed / completed`，
其修補 `0093` 已在正式庫生效。

### 一次差點犯下的 PB-037

我第一次驗 guard 時，查的是函式本體是否含 `COMPLETED` / `CANCELLED` / `NO_SHOW`——
三項全部 `false`，看起來像是「ledger 有記、guard 沒生效」的正式庫漂移。

**但那是我查錯了。** 那三個字是 `0093` **註解裡**轉述 Owner 裁示的措辭；實作刻意用
**白名單**（`0093:51-53` 自己寫明理由：「用白名單而不是黑名單：`booking_status` 之後
若新增列舉值（例如 REFUNDED），黑名單會預設放行」）。所以那三個字本來就不會出現在函式裡。

先讀 canonical 再下結論，才沒有把一個正確的 guard 誤報成正式庫漂移。這正是 PB-037
（「用一次找不到的搜尋證明它不存在」）的同型陷阱——**比對內容，不要比對我以為的措辭**。

### 處置：列為候選，**不自行關閉**

#218 與 #246 不同。它第 9 格的語意不只是「0090 是否已套用」，而是
「**是否已取得逐次具名授權後套用**」。套用發生在 2026-09-08，授權紀錄不在本輪視野內，
**確認那次套用是否經過授權，是 Owner 的判斷，不是 runner 的**。

因此本輪只做到：把事實查清楚、把阻擋理由已失效這件事講明白，交給 Owner 一句話裁示。
