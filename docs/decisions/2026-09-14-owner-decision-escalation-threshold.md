# 2026-09-14 Owner Decision — 決策升級門檻

## 背景

近期多個 Issue 的 `人工介入點` 仍保留舊的 A／B 選項，但後續 canonical 規格、Owner 留言、實作證據或三方核對已經把其中一個選項證明為唯一合理處置。

如果執行者只因 Issue body 還寫著「待決」就再次向 Owner 提問，會造成：

- 重問已裁示事項；
- 把 stale issue wording 當 CURRENT TRUTH；
- 讓不存在的工作項或不可能完成的驗收格阻擋交付；
- 把可以自主收斂的工程／文件一致性問題誤升級成產品決策。

2026-09-14 Owner 明確要求：**這類有明確答案的選項，不需要交給 Owner 決策。**

## 決策

只有在存在**兩個以上都合理、且會造成實質不同產品／商業／風險結果**的方案時，才需要升級 Owner 決策。

以下情況預設由執行者自主處理，不得為了形式上的 A／B 選項再問 Owner：

1. current `main` 的較新 Owner Decision 已經回答；
2. Issue comments 已有較新的 Owner 裁示，但 Issue body 沒回填；
3. canonical 規格已明確定義行為；
4. repo／測試／三方核對已證明某個工作項不存在、重複、被其他 Issue 正確承接或已被 supersede；
5. 一個驗收格因前提不存在而永遠無法成立，且移除它不會刪除任何真實產品能力；
6. 只是文件／Issue scope reconciliation、stale wording 清理、重複項歸併或已知事實同步；
7. 已有安全預設，且不同選項不會改變核心產品方向、營收、法律／安全邊界或造成不可逆影響。

上述情況應：

- 先讀 current `main`、相關 Owner Decision、Issue body **與完整 comments**；
- 以較新且較高順位的證據為準；
- 自主修正 stale scope／文件／Issue 狀態；
- 留下最小證據與理由；
- 不把「Issue 曾經寫成待決」當成再次詢問 Owner 的充分理由。

## 必須升級 Owner 的情況

以下仍屬真正 Owner gate：

- 核心產品方向或主要 UX 行為有真實取捨；
- 營收模式、正式價格、平台角色或重大商業政策；
- 法律、合規、隱私或高風險安全邊界；
- Production DDL／DML、正式付款／退款、正式部署或其他明確要求 Owner 授權的操作；
- 不可逆資料處理、跨 repo 契約重大改動；
- 兩個以上合理方案的差異會明顯影響使用者、成本、營運或風險，而 canonical 資料沒有答案。

## 去重規則

在提出任何 Owner 決策題前，必須先完成：

1. current `main` canonical 文件搜尋；
2. `docs/OWNER-DECISIONS.md` 與 `docs/decisions/**` 搜尋；
3. 目標 Issue 的 **完整 comments** 搜尋；
4. 相關已合併 PR／commit 的搜尋；
5. 確認沒有較新裁示或已落地實作證據。

只讀 Issue body 不足以宣告「仍待 Owner 決策」。

## 本次套用

Issue #22 的「settings 三支雜項」經查證實際為 0 支，五支真實缺口皆已有其他正確歸屬。因此不存在真實 A／B 產品取捨，應自主移除不存在的 scope 與不可能完成的驗收格，不再把它當 Owner blocker。

## 非本決策內容

- 不放寬 Production 授權規則。
- 不允許執行者自行發明產品規格。
- 不允許用「自主判斷」跳過已有 canonical 或安全規則。
- 不降低 Completion Truth、PR lifecycle、CI 或 Final Risk 要求。
