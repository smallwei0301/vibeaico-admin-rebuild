# Owner Decision — Final Risk ROI 路由收斂

> 裁示日期：2026-09-10
> 追蹤 Issue：#332
> 來源：Owner 在檢視 Astra/Fable 實際 Finding Yield 與等待成本後，要求依 ROI 收斂 Final Risk。

## 1. 目的

Final Risk 保留給「後果高，而且獨立高階 reviewer 能提供正交價值」的變更，不再把所有治理變更一律視為同等風險。

這不是取消 Astra/Fable，也不是降低 PAYMENT / AUTH / IRREVERSIBLE DATA 等高後果變更的標準。目標是移除純 hardening / observability 類工作的重複審查成本。

## 2. 必須保留 Final Risk 的類型

下列現行高風險類型維持不變：

- `PAYMENT_CONSISTENCY`
- `TENANT_AUTH_BOUNDARY`
- `IRREVERSIBLE_DATA`
- `CROSS_REPO_CONTRACT`
- `UNRESOLVED_HIGH_RISK`

`GOVERNANCE_GATE` 仍是高風險，但從本決策起收窄為：

> 會降低、放寬、繞過、豁免、延後或改變 merge/admission/model/deploy/permission/evidence gate 的允許範圍，或可能把原本的 failure/pending 轉成 success/approval 的治理變更。

典型例子：

- 修改 Final Risk allowlist / requested-vs-actual model 驗證；
- 新增 bypass / waiver / exception；
- 放寬 required status / merge admission；
- 放寬 Production / deploy / provider 權限門禁；
- 讓原本 fail-closed 的缺證據情境改成可放行；
- 變更 executable gate 本身，使其可接受更多候選。

這些仍必須由 Astra/Fable 做 Final Risk。

## 3. 純 fail-closed hardening 不因「治理」兩字自動升級

若一個治理變更同時符合以下全部條件，可填：

`ASTRA_RISK: NONE`

並以 Sol final audit + adversarial tests 作為最終技術審核，不強制 Astra/Fable：

1. 不命中 `scripts/agents/**`、`.github/workflows/**` 或 `model-routing.json` 現行 sensitive-path 底線。
2. 不增加任何可被接受、可 merge、可 deploy、可取得權限的狀態。
3. 只增加拒絕條件、證據完整度、reconciliation、metrics、observability 或 fail-closed 驗證。
4. 刪掉該變更後，最壞結果是「少抓到錯誤」，而不是「多放行原本會被擋的高風險操作」。
5. 有 adversarial / mutation / negative tests 證明它是在收緊，而不是靠 PR 文字自稱 hardening。
6. Sol 能明確判斷風險方向；有疑義時不得套用本例外。

例如 Scoreboard metrics 的 duplicate evidence 拒絕、invalid timestamp fail-closed、stale finding reconciliation，若都位於非 sensitive path，就屬這一類。

## 4. Sensitive path 是不可由文字降級的保險絲

現行 executable path heuristic 保留：

- `scripts/agents/**`
- `.github/workflows/**`
- auth/payment/refund 等現行 `model-routing.json` sensitive paths

任何 PR 只要實際 changed files 命中這些路徑，即使 PR body 填 `ASTRA_RISK: NONE`，classifier 仍必須要求 Final Risk。

因此本決策只收窄「語意分類過寬」，不拆 executable safety floor。

## 5. 不確定時往高風險分類

以下任一成立，不得用 `NONE`：

- Sol 無法證明變更只會 fail closed；
- 同一 PR 同時含 hardening 與 relaxation；
- 變更會修改可接受狀態集合；
- 變更會修改 model routing、waiver、exception、merge/deploy admission；
- changed files 命中 sensitive paths；
- 其他高風險類型同時成立。

此時使用 `GOVERNANCE_GATE` 或 `UNRESOLVED_HIGH_RISK`。

## 6. Review 成本規則

- 預設每個 semantic content digest 只做一次 Final Risk。
- 只有 Final Risk 找到 blocking finding、內容修正後，才進第二輪。
- 純 rebase 且 `changeDigest` 不變，不重跑 semantic Final Risk；仍重跑 exact-head CI。
- Draft / PARKED / OWNER_BLOCKED 等非 active 候選維持 deferred，不消耗 Final Risk。
- Final Risk reviewer 的工作不是重念 CI，而是專攻 concurrency、tenant boundary、rollback、permission bypass、fake-success、negative control 等 adversarial failure modes。

## 7. ROI 觀測

後續複盤至少區分：

- substantive finding rounds：有新增 finding 或新增正交證據；
- pure-churn rounds：純 rebase / policy churn / 重複確認；
- Final Risk wait time；
- 實際 token cost（平台可取得時；不可取得時維持 unknown，不估算）。

目標：pure-churn Final Risk round < 10%。

## 8. 本決策自己的安全邊界

本決策本身是在收窄未來 Final Risk 的語意觸發範圍，因此 **本次 #332 實作不得使用這份新規則替自己免審**。

#332 對應 PR 必須依合併前 `main` 的既有規則標 `ASTRA_RISK: GOVERNANCE_GATE`，取得一次可信 Astra/Fable Final Risk 後才能合併。

本決策不修改 Production DDL/DML、部署、付款、退款、LINE、顧客通知、模型 allowlist 或 Owner 授權邊界。
