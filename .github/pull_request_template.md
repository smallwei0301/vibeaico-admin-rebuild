<!--
Agent／自動施工 PR 請保留並填寫以下欄位。
人工 PR 若不進入自主施工 lanes，使用 PARKED / PARKED / N/A，並可保留其餘預設值。
ACTIVE 候選必須把 NEXT、AUTONOMOUS_GAPS、WHY_NOT_OTHER_ACTIVE_PRS 改成具體內容，
EXPECTED_FULL_CI_COUNT 只能填 0、1 或 2。
-->

AGENT_LANE: PARKED
CANDIDATE_STATUS: PARKED
CLOSEABILITY: N/A
NEXT: N/A
AUTONOMOUS_GAPS: N/A
WHY_NOT_OTHER_ACTIVE_PRS: N/A
EXPECTED_FULL_CI_COUNT: 0

## Scope

- Issue：
- Base / exact head：
- 本 PR 解決：
- 明確不處理：

## Acceptance evidence

- Targeted tests：
- Full CI：
- Preview／外部證據：
- 未驗證：

## Agent handoff

- Requested model / actual model：
- Current TEST lane：
- Next safe action：
- Sol verdict：

## Safety boundaries

- [ ] 未執行未授權的 Production DDL／DML／部署
- [ ] 未執行真實付款／退款／顧客通知
- [ ] 沒有把 Draft／部分綠燈冒充 Issue 已完成
