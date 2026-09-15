# Closure sweep — 2026-09-14-product-delivery-r01 / sweep 06

結果：**EMPTY_WITH_SCAN**（無可關候選）

掃描範圍：10 張 open PR、45 張 open Issue（scout 實掃 20 張）。委派
`claude-haiku-4-5`（scout 層），結論由 audit 層（`claude-opus-5`）逐項覆核。

## scout 提出的兩個候選，覆核後都不是「可關」

| 候選 | scout 理由 | 覆核結果 |
|---|---|---|
| PR #443（0109 schema 斷言） | `AUDIT_READY`，只差 CI 與 Final Risk | **不是 closure 候選，是進行中的 MAIN。** 它需要的是走完 gate，不是「收尾動作」。覆核當下它已在跑 Final Risk，隨後以 merge commit `6989869` 合併。 |
| PR #312（#228 Preview ignore guard） | CI 綠、Sol 通過，等 #322 提供 Final Risk 身分 | **不是可關，是被外部依賴擋住。** `LANE_STATE: OWNER_BLOCKED`。把「等別人」寫成「只差收尾」會讓 closure 數字虛胖。 |

## 覆核抓到的兩處 scout 事實錯誤

這兩處都不是判斷分歧，是**沒有查證就下斷言**，而且都指向正式環境。

### 錯誤一：宣稱正式庫缺 `keyword-reply-images` bucket，圖片上傳會 500

scout 寫：「PR #264 已合併進 main（bucket policy 已加），但正式庫
`keyword-reply-images` bucket **未建立** → 正式站圖片上傳會 500」。

實查正式庫 `storage.buckets`：

```
keyword-reply-images | public=true | file_size_limit=null | allowed_mime_types=null | created_at=2026-09-07 23:17:38+00
```

**bucket 存在。** 而且 canonical `0086_keyword_reply_images_bucket.sql` 的內容只有：

```sql
insert into storage.buckets (id, name, public) values
  ('keyword-reply-images', 'keyword-reply-images', true)
on conflict (id) do nothing;
```

沒有設 size／mime 限制。所以正式庫的 `null / null` **與 canonical 完全一致，不是漂移**。

真正存在的問題是 Issue #402（該 bucket 無大小與格式限制），但那是 **canonical 自己的
缺口**，要補就是新開一支 migration，不是「正式庫少了東西」。scout 把兩件事混成一件，
並且從一個未查證的前提推導出一個不存在的線上故障。

### 錯誤二：推薦 #22 作為下一輪 MAIN，宣稱「無依賴」

scout 寫「為何現在可做：無 migration 前置…依賴檢查：無」。

實讀 Issue #22 內文**第一行**：

> **前置：補齊-6（#21）驗收清單全數打勾（含證據）。** 本 issue 完成前，補齊-8（#23）以後全部不得開工。

再讀 #21 第一行：

> **前置：補齊-5（#20）驗收清單全數打勾（含證據）。**

#22 卡在 #21，#21 卡在 #20，兩者都還 open。#22 另外還有兩個未決的 Owner 裁示點，
以及「migration 若有，要套用**兩個** Supabase 專案」的驗收要求——與「無 migration 前置」
的描述相反。

## 方法教訓（本 Run 第三次 scout 方法錯誤）

前兩次記在 `s05`（把 reopened Issue 的舊驗收框當成可關證據）與 Run ledger 的
`luna-ci-r01-s08`（把 CI 失敗歸因於時間相鄰的 commit）。這一次的共同形狀是：

> **從一個沒有查證的前提，推導出一個具體且聽起來緊急的結論。**

「bucket 未建立 → 上傳會 500」與「無依賴 → 可以現在做」都不是觀察，是推論；而兩個
推論的前提都只要一條查詢或讀一行 Issue 內文就能證偽。

audit 層的對策不是不用 scout——窄盤點交給 scout 層是對的分工——而是：**scout 回報裡
任何指向環境狀態或依賴關係的斷言，採用前必須自己查一次原始來源**。這一輪兩處都是這樣
抓到的。

## 其餘掃描結果與各自不是候選的理由

### Open PR

| PR | 狀態 | 不是候選的理由 |
|---|---|---|
| #444 / #445 | GOVERNANCE，Owner origin | `MERGE_STATUS: NOT_REQUESTED`，且非本 Run 的 lane（覆核期間已合併） |
| #443 | MAIN（已合併） | 見上表 |
| #448 | MAIN（進行中） | 本輪新開的第 7 類切片，不是可關對象 |
| #312 | OWNER_BLOCKED | 等 #322 |
| #99 / #98 / #96 / #87 | PARKED | 明確 PARKED，依 §5 不得推進 |
| #92 / #89 / #86 | OWNER_BLOCKED | 各自等 Preview 環境／#34 AppShell／#8 與 #37 契約 |

### Open Issue（重點）

| Issue | 不是候選的理由 |
|---|---|
| #41 / #43 | Epic。底下切片仍有明確未完成項（#41 的 §5–§9、#43 的第 6／8 類），Epic 標籤本身不可關 |
| #396 | TEST 九個無出處欄位處置未決（依賴盤點已完成，見 `docs/schema-truth/2026-09-14-test-drift-dependency-inventory.md`），正式庫帳本分歧亦未收斂 |
| #20 / #21 / #22 / #23 | 「補齊」鏈，真正的龍頭是 #20，尚未開工 |
| #402 | canonical 缺口（bucket 無限制），需新 migration，未開工 |
| #50 | 邏輯完成，但 #402 的限制問題掛在同一個 bucket 上 |
| #228 | 由 #312 承接，#312 被擋 |
| #104 / #359 | 觀測／可選項，非實作 |

## 本輪 closure 結果

`closureAdvancedOrClosed`：0 張 Issue 被關。兩張 PR（#442、#443）在本輪內由 MAIN
線推進到合併，但那是出貨不是 closure——closure 指的是「已實質完成、只差收尾動作」的
既有欠帳，本輪確實沒有。
