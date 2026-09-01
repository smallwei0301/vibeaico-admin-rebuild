# Agent Run Scorecard 使用說明

每一輪 B+ 施工都留下同名 JSON 與 Markdown：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

JSON 是原始帳本，Markdown 是給人看的報告。`score-run.mjs` 會從 JSON 重新計算分數，避免
模型在報告中自己把 62 分寫成 92 分。

## 五個分數

1. **模型與 usage 效率 25 分**：實際 token 或內部加權 usage、Luna 分派率、Sol 接觸、
   完整對話重傳、無效重跑。
2. **完成效率 25 分**：CLOSED／OWNER_BLOCKED／AUDIT_READY、carryover、MAIN／RESERVE／
   candidate／TEST 峰值與 Closure 成果。
3. **品質與安全 30 分**：驗收覆蓋、首次完整 CI、Audit 一次通過、P0／P1、回歸與安全。
4. **多 Agent 流動 10 分**：Luna 採用率、重複任務、檔案撞車、等待時間是否轉成有效工作。
5. **可稽核證據 10 分**：Issue／PR／SHA、TEST run、精確 blocker、過時描述與可重算性。

## 實際 token 與內部權重

- 平台提供 token／週 usage 時，原值照實記錄。
- 平台不提供時，`actualTokensAvailable=false`，使用 Luna=1、Terra=3、Sol=6 的內部比較值。
- actual model 不可驗證時保留 `unknown`，並以 requested model 暫估。
- 權重只是專案用尺，不是 OpenAI 官方費率或額度換算。
- 任何缺資料保留 `null`，不能用看起來合理的數字填洞。

## Completion Truth Gate

分數計算以前，先查證報告裡的完成主張：

```text
PR merged       → live PR + merge SHA + main reachable compare + ref=main file
Issue closed    → live Issue state=closed + CLOSE_APPROVED when required
CI green        → same exact head + all required jobs terminal success
migration       → exact project ref + live migration history
file on main    → fetch path with ref=main
```

只送出 merge／close／deploy 等動作，或只收到 API 成功回應，不算完成。未查證時使用
`*_REQUESTED_UNVERIFIED`，不得填成已完成。

報告或 Session 宣稱完成，但 live 狀態不支持時：

```text
AUDIT_DATA_INVALID
quality.safetyViolations += 1
quality.hardFailReasons += completion claim was not verified
grade = F-HARD
```

這種錯誤會污染後續施工座標，因此不能靠其他高分補回，也不能事後改寫舊報告掩蓋。

## 復盤看什麼

單輪總分只是溫度計，真正重要的是最近三輪趨勢：

```text
weighted usage / delivery unit
issues closed
complete owner-blocked
carryover
quality score
Sol touches per Issue
Luna adoption rate
invalid CI reruns
completion truth failures
```

若總分上升，但品質下降、安全失敗或完成主張未驗證，不能判定為優化。
