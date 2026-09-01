# B+ Agent Run 報告：2026-09-01-pre-bplus-baseline

> 狀態：BASELINE
> 總分：**59.9 / 100（F）**
> 合格：是

## 一眼看懂

- main：`ee22d0f184ddbba1ffdc4421c5caf9ec3ef17fa5` → `ee22d0f184ddbba1ffdc4421c5caf9ec3ef17fa5`
- Open Issue：40 → 40
- Open PR：15 → 18
- 出貨單位：1
- 內部加權 usage：42（Luna／Terra／Sol 權重，非官方 token）
- 每出貨單位加權 usage：42
- 實際 token：平台未提供，不推測
- 模型歸屬未驗證任務：10（actual=unknown 時以 requested model 做內部估算）
- 週 usage 變化：資料不足

## 五面向分數

| 面向 | 分數 |
|---|---:|
| 模型與 usage 效率 | 16.2 / 25 |
| 專案完成效率 | 10.5 / 25 |
| 品質與安全 | 18.9 / 30 |
| 多 Agent 流動效率 | 7.7 / 10 |
| 可稽核證據 | 6.6 / 10 |

## B+ lane 證據

- MAIN_TERRA 峰值：5（目標 1）
- RESERVE_TERRA 峰值：0（目標 ≤1）
- Active Candidate 峰值：5（目標 ≤2）
- Shared TEST 峰值：1（目標 ≤1）
- Closure Sweep：1 次，推進／關閉 1 次

## 出貨與品質

- Issues started：4
- Issues closed：0
- Audit ready：0
- 完整 Owner-blocked：1
- Carryover：3
- Full CI：3；無效重跑：0
- 未解 P0/P1：0 / 6
- Luna 採用率：75%
- Sol 每 Issue 接觸：2

## 下一輪只調整這些

1. 把完整 Terra 出貨線降到 1；其餘只保留一條 source-only 預備線，其他 PR 先 PARKED。
2. Active Candidate 峰值超過 2；下一輪只保留 MAIN 與 Closure 候選。

## 資料限制

- 這是 B+ 導入前基準，不是完成輪次；它混合附件 Session 的可見軌跡與同日 live GitHub 盤點。
- 平台沒有提供實際 token 或週 usage 起訖，因此沒有推測真實額度消耗。
- 模型任務數只記錄可從附件辨識的最小工作群；actual model 無法驗證，故 actualModel=unknown。
- Issue close 數在附件與 live 盤點中都沒有可證明的下降；#17 僅記為完整 Owner-blocked 出口。
- P1 數取自附件中一次 API/security review 回報的 6 個 P1；不是整個 repo 的 P1 總數。

---

本報告由 `scripts/agents/score-run.mjs` 從同名 JSON 重算。內部模型權重只用於輪次比較，不是 OpenAI 官方額度換算。
