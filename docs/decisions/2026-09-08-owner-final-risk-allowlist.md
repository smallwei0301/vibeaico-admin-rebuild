# Owner 裁示：最後風險評估允許 Astra 或 Fable

- 日期：2026-09-08
- 相關 Issue／PR：#209、#290
- 授權形式：Owner 於本輪明確要求擴充既有最後風險評估模型限制

## 裁示

保留 `scripts/agents/model-routing.json` 的 `models.finalRisk` 作為預設模型；目前仍是
`claude-fable-5-1`。新增 `models.finalRiskModelCatalog` 作為支援的模型身分，並以
`models.finalRiskAllowedModels` 作為最後風險評估的明確 allowlist；現行兩份清單內容為：

```json
["gpt-6-astra", "claude-fable-5-1"]
```

guard 只接受 `requestedModel` 與 `actualModel` 完全相同且同時位於 allowlist 的 review。
缺失、非陣列、空值、重複、catalog 外模型或兩者混用一律 fail closed。

政策版本升為 `2026-09-08.3`；既有以 `2026-09-08.1` 或 `2026-09-08.2` 產生的 attestation 不得直接沿用，
必須依新政策重新驗證。

## 不變的安全證據

- trusted GitHub review 與寫入者權限驗證不變。
- exact base/head、review commit、review 狀態、operator attestation、測試／schema 基線及 GitHub 報告 URL 不變。
- `highRisk`、`sensitivePaths`、Astra gate 名稱與 `ASTRA_*` 欄位不變。
- 實際評估仍必須委派給 allowlist 中的一個模型；不得由 PR body 自填或代填 attestation。

本裁示只 supersede 2026-09-08 Fable 裁示中「只允許單一模型」的操作限制；Fable 仍是預設模型，
其餘證據與 Production／TEST 授權邊界不變。
