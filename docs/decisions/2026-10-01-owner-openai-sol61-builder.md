# Owner 決策：OpenAI Product builder 使用 Sol 6.1

- 生效：`2026-10-01T00:01:00Z`。
- 理由：Owner 成本／可用性選擇；目前可派 catalog 沒有 Terra builder。
- 來源：delegated transcript，thread `01a0f0a8-6b29-709b-ba73-1a1a499d1020`。
  Assistant `Sentinel_dc97f8d1cb788191ba33bdf0f095a2e4` 提議限定 Sol 6.1 寫窄測試工具、獨立審查、只做本地 mock／dry-run、不碰 TEST 資料庫。
  User `Sentinel_254c7297e58c819183454711263dde7c`（2026-10-01 00:01 UTC）：「批准，並且將agent-excution 文件中，相關的terra模型使用改成sol-6.1」。

## 2026-10-01 00:47 UTC 角色細化

來源同 delegated thread；User `Sentinel_4c83de338e208191b69372c42cfd951c`：「builder : sol-6.1, reviewer: sol-6.1, scout: luna-6, 高風險審查才指派reviewer: astra」；並要求「如果有使用到Astra, 務必必須埋點紀錄等等才可以放行使用」及同環境 subagent 機制讓執行 Agent 自主繼續。requested 必須記實際明確派工 ID，actual 缺可靠 runtime 證據仍 `unknown`，不將例句當 served identity。

Owner 新指示由同環境 subagent／multiagent 明確選角色模型；主 Agent 保留 ownership、收回驗證後繼續。Luna 窄盤點與 Aggregator；Sol 6.1 施工與普通審查，review actor／fresh context 獨立；Astra 6 僅 classifier 高風險 Final Risk，不施工／盤點，不用於普通風險。OpenAI finalRisk default 改 `gpt-6-astra`，Anthropic Fable／其他映射保留。先持久化且回讀成本／scope／lineage 預約才可 dispatch；#552 合計一次、同級零 retry、300 秒無執行證據及首次環境錯誤直接 fallback 不變。此為 delegated Owner 指示記錄，不是 model execution receipt。

## 當前 build 路由

OpenAI `models.build` 從 `gpt-5.6-terra` 改為 `gpt-6.1-sol`，`models.audit` 同為 `gpt-6.1-sol`。
Terra 是施工 lane 名稱，不是 observed model identity。不同角色可以使用同模型 ID，
但 builder 與獨立 reviewer 必須不同 actor／session，builder 不得自審放行。
requested 記實際派工 ID；沒有可靠 actual runtime receipt 時仍填 `unknown`。

保留 Anthropic scout／build／audit 對應、所有 lane 名稱／容量數值、Loop 埋點、
TEST holder／隔離契約、獨立 review、Final Risk、成本上限、安全／CI／Production gate。
不改寫歷史 actual Terra、舊 Run／receipt，頂層審查 policy version 不 bump。

00:01 當時授權範圍僅本地治理實作與 harness mock／dry-run，當時發布需另回報。
00:30 User `Sentinel_ad0d6c759ac08191aa6b18861378f7f0`：「批准把這批兩專案的「模型路由＋Scout 防漏派＋Playbook」修改推送並建立 Draft PR」。00:47 角色細化接續既有 #711／#712 治理範圍；此後續發布授權不含新增 harness。
仍沒有 remote TEST／DB、merge、deploy、Production、credentials 或新增權限授權。
