# Owner 決策：OpenAI Product builder 使用 Sol 6.1

- 生效：`2026-10-01T00:01:00Z`。
- 理由：Owner 成本／可用性選擇；目前可派 catalog 沒有 Terra builder。
- 來源：delegated transcript，thread `01a0f0a8-6b29-709b-ba73-1a1a499d1020`。
  Assistant `Sentinel_dc97f8d1cb788191ba33bdf0f095a2e4` 提議限定 Sol 6.1 寫窄測試工具、獨立審查、只做本地 mock／dry-run、不碰 TEST 資料庫。
  User `Sentinel_254c7297e58c819183454711263dde7c`（2026-10-01 00:01 UTC）：「批准，並且將agent-excution 文件中，相關的terra模型使用改成sol-6.1」。

## 當前路由

OpenAI `models.build` 從 `gpt-5.6-terra` 改為 `gpt-6.1-sol`，`models.audit` 同為 `gpt-6.1-sol`。
Terra 是施工 lane 名稱，不是 observed model identity。不同角色可以使用同模型 ID，
但 builder 與獨立 reviewer 必須不同 actor／session，builder 不得自審放行。
requested 記實際派工 ID；沒有可靠 actual runtime receipt 時仍填 `unknown`。

保留 Anthropic scout／build／audit 對應、所有 lane 名稱／容量數值、Loop 埋點、
TEST holder／隔離契約、獨立 review、Final Risk、成本上限、安全／CI／Production gate。
不改寫歷史 actual Terra、舊 Run／receipt，頂層審查 policy version 不 bump。

本輪授權僅本地治理實作與 harness mock／dry-run；新治理／harness 發布仍須先回報 scope。
沒有 remote TEST／DB、merge、deploy、Production、credentials 或新增權限授權。
