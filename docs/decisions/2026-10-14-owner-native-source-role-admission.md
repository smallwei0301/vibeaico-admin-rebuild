# Owner：正式接受可驗證的原生 source 角色執行紀錄

日期：2026-10-14。來源：本 session Owner 明確指示「讓規則正式接受可驗證的原生執行紀錄」。
[Issue #977](https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/977) 是主 Agent 對指示與範圍的 operator 轉記，不冒稱 Owner 另在 GitHub 發言。

問題是 runtime 親見 spawn 回傳只有 native task_name，沒有 backend actorId/sessionId；
保存原始 request/result/work/completion 可以解決紀錄遺失，不能產生平台未提供的欄位。
#946 單次延後及 #848 exact-source pilot 沒有修復後續 source 的常態准入。

沿既有 `nativeRolePilot`、`nativeRoleShapeErrors`、trusted GitHub adapter 與本機 preflight，
正式啟用 version `2026-10-14.1`／scopeMode `REPOSITORY_SOURCE`，只限本 repo 的
`PRODUCT_SOURCE_FINAL_RISK`（普通 Sol source review 與適用高風險 source review）。
不再綁某個固定 PR allowlist；每筆角色及 review 仍須精確綁實際 PR/head/changeDigest。

必要證據仍是兩筆可信同 PR canonical comment、親見原 spawn request/result、work 與停筆完成、
不同任務/execution/comment、相同 operator 限定 namespace/capture generation、完整成果 hash。
兩角色必須親見已啟用 main policy 後才 spawn；BUILD 完成與 canonical BUILD bytes 回讀後，
才另建 `fork_turns=none`、未參與 build 的 fresh FINAL reviewer。source bytes、提交者權限、
時間及 config generation/ancestry 沿既有 adapter 回讀，branch/payload 不能自啟。

原 message 是字串原文，或真實受限保存的逐字 UTF-8 commitment（RETAINED_ORIGINAL_V1）：
完整 hash/byteLength、operator、角色、任務、來源、時間、成果及公開工作範圍逐項綁定。
公開 scope 不是原文；沒有即時保存原文不能使用 commitment，歷史 NOT_CAPTURED 不延伸到新政策。
新政策使用完整 UTC 小數順序，避免 1ns 倒序被毫秒解析掩蓋。舊 #843/#848 fixtures 保留歷史回播。

原生識別是可信操作者親見背書，不是平台 actor/session 或 provider-signed telemetry。
actorId/sessionId 必須 null、backendIdentityAvailability=UNEXPOSED、actualModel=unknown、
identityEvidence=UNKNOWN、servedVerified=false；不以 parentID/taskname/GitHublogin 冒 backend 身分。
GitHub 可核 bytes、權限與一致性，無法獨立證明隱藏 spawn、context 隔離或私下原文背書真實；
自洽不實的 operator 背書仍可能無法辨識。沿既有原生試行的這一限制如實保留，不宣稱全防偽。

BUILD/reviewer model request、獨立技術審查、零未解 finding、exact CI/TEST、WIP/publication、
#552 成本/provider/model 契約及 branch protection 不變。新政策不替本治理 PR 自批。
正常治理測試、獨立 exact-diff/counterexample review、merge/main 回讀後才生效；啟用前的缺證角色不補造。

DB release/G5/writer、Production 權限、真實付款/退款/通知及 destructive 禁止事項完全不在本次範圍。
#946 deferral 保留精確 source 歷史，不改成一般免審；舊 ledger/counter/model/時間不回填。
