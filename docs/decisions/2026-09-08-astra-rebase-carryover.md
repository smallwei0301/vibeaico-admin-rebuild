# 治理修正：純換底不再需要重跑最後風險評估

- 日期：2026-09-08
- 相關 Issue／PR：#209、#292、#280、#271
- 授權形式：Owner 於本輪明確指示「先進行這個治理層問題修改」

## 問題（有實際數據，不是理論）

`evaluateAstra` 原本以 `find(r => r.commitId === context.headSha)` 挑評估紀錄，
等於要求 review 必須釘在**當下的 head commit** 上。

rebase 只換 parent、不改任何檔案內容，卻會產生一顆新的 commit sha。於是：

> `main` 只要有任何一支 PR 合併，所有在途的高風險 PR 都必須重跑最後風險評估。

實際發生的情形：

| PR | 輪次 | 其中因換底／政策升版而重跑 |
|---|---|---|
| #292（#176 活動獎勵） | 4 | 2（第 3→4 輪只是換底，`git diff base..head` 逐字相同） |
| #280（#218 點數原子化） | 1 | 0——**是在窗口內險勝，不是機制保證** |

每一輪重評都不是免費的，而 `main` 隨時可能再前進。這讓高風險 PR 在活躍的 main 上
難以收斂，而收斂不了的代價會反過來變成「乾脆別做高風險的修正」。

## 裁示與作法

以**變更內容指紋**取代「commit 身分」作為綁定：

`changeDigest` = 取每一個 changed file 的（最終路徑、rename 前路徑、狀態、
**head 上的 blob sha**），排序後 sha256。值由**受信任的預設分支**這份程式從 GitHub
直接給的 `pulls.listFiles` 算出，不採信 PR 或 attestation 自填的任何內容。

- rebase 不改檔案內容 → blob sha 逐一相同 → 指紋不變 → 舊評估仍然有效。
- 換底過程中任何一個檔案被靜默合併、或有人趁機夾帶修改 → 該檔 blob sha 改變 →
  指紋改變 → 舊評估立刻失效。

`baseSha` / `headSha` **仍為必填且仍驗格式**，但角色從「放行條件」改為「稽核紀錄：
當時審的是哪一顆」。

### 安全性論證

指紋只涵蓋**變更過的檔案**，未變更的檔案來自 base；而 PR 的 base 是受保護的預設
分支，它自己的每一次前進都通過同一道閘門。所以「舊評估 ＋ 新 base」＝「已審查過的
檔案內容 ＋ 已受同一道閘門把關的基底」，沒有任何一邊是未經審查的。

### 同一次修改順帶**收緊**的一處

檢查器改為取**最新的一筆**可信 review 再要求它對得上本候選。原本的
`find(commitId === headSha)` 會直接跳過釘在別顆 head 上的較新否決，讓一份較舊的
PASS 存活——那是既有的漏洞，本次一併補上。

## fail closed 的每一道

- `listFiles` 被截斷 → 呼叫端 `Incomplete changed-file inventory` 直接丟出。
- 任一欄（路徑／狀態／blob sha）缺漏 → `changeDigestOf` 回空字串，不產生一個
  比對得過、實際上沒涵蓋內容的指紋。
- `context.changeDigest` 不是 64 碼 → `Missing change digest for this candidate`。
  少了這一道，兩邊都 `undefined` 時比對會「通過」，整條放寬會變成無條件放行。
- attestation 的 `changeDigest` 缺漏、格式不符或不相同 → `Astra evidence is stale`。
- attestation 的 `baseSha` / `headSha` 非 40 碼 → 同樣擋下（稽核線不得斷）。

## 不變的部分

trusted GitHub review 與寫入者權限驗證、exact review 狀態、operator attestation、
測試／schema 基線、GitHub 報告 URL、`highRisk`、`sensitivePaths`、模型 allowlist、
「不得代填」原則，全部不變。

## 版本與既有 attestation

政策版本升為 `2026-09-08.4`。既有 attestation 因缺少 `changeDigest` 會失效一次，
必須依新格式重新提交——這是契約變更的必然代價，且是 fail closed 的方向。
