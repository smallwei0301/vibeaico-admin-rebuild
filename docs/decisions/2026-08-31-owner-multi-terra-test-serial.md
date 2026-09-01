# 歷史決策：多 Terra 分 Issue、shared TEST 單線（Mode C）

> 原裁示日期：2026-08-31
>
> 狀態：**已於 2026-09-01 被 B+ 取代。**
>
> 最新裁示：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`

## 歷史背景

Mode C 原本允許不同 Issue 各有一位 Terra 同時做完整 BUILD，並只把 shared TEST 維持
全域單線。它成功避免 CI／TEST 等待時整個專案停擺，也建立以下仍有效原則：

- 同一 Issue 不能由兩位 Terra 同時實作；
- shared TEST migration／reset／seed／schema-cache／integration／E2E 只能一條；
- Luna Closure／Janitor 獨立運作；
- Sol 只做高價值 TRIAGE、模糊診斷與 Audit；
- 不重跑 superseded SHA，不以 no-op commit 觸發 CI。

## 為什麼被 B+ 取代

實際執行顯示，不同 Issue 同時開多條完整 Terra 會讓程式快速完成，卻在 TEST、Sol Audit
與 closeout 的窄出口堆出多張半成品 PR。上下文切換、Review 擴張、CI 排隊與 Sol 重讀也
會抵銷多工帶來的速度。

因此最新 B+ 改為：

```text
1 MAIN_TERRA 完整出貨線
1 RESERVE_TERRA source-only 備料線
1 LUNA_CLOSURE
3～6 個窄任務 Luna
1 shared TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE
```

## 仍可沿用的 Mode C 教訓

- MAIN 等待時，RESERVE 與 Luna 可做不碰 shared TEST 的工作。
- File／scope collision 仍需明確 ownership。
- 不應把 TEST 忙碌當成整個 goal 停止理由。
- 歷史 PR、commit 與 exact-head CI 證據保留，不 reset 或抹除。

不得再引用本文件作為同時啟動第二、第三條完整 Terra BUILD 的依據。
