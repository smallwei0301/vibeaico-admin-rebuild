# Phase 2A：Supabase Preview Branch 控制層

> 追蹤：Issue #104
>
> 狀態：控制層候選，尚未建立任何計費 branch
>
> Parent TEST project：`nmwhwngojosmagjuvxol`

## 1. 這一階段先做什麼？

Phase 1 已讓一般 PR 在自己的本機 Supabase 跑完整 integration／E2E。Phase 2 處理本機仍無法
完整代表的重型變更：

```text
supabase/migrations/**
Auth／middleware
Storage／upload
```

這些候選需要一個真正的雲端 Preview Branch，才能驗證雲端 Auth、Storage、PostgREST、
schema cache 與 branch 自身憑證。但建立 branch 會計費，所以先把不花錢的控制層做完。

## 2. 分類器

檔案：`scripts/ci/remote-preview-branch-policy.mjs`

它會讀：

```text
PR changed paths
TEST_PROFILE
MIGRATION_TOUCH
AUTH_TOUCH
STORAGE_TOUCH
```

輸出：

```text
SOURCE_ONLY
LOCAL_ISOLATED
REMOTE_BRANCH_REQUIRED
```

例如：

```text
src/components/Card.tsx                 → SOURCE_ONLY
src/app/api/services/route.ts           → LOCAL_ISOLATED
supabase/migrations/0065_example.sql     → REMOTE_BRANCH_REQUIRED
src/app/api/auth/callback/route.ts       → REMOTE_BRANCH_REQUIRED
src/app/api/upload/image/route.ts        → REMOTE_BRANCH_REQUIRED
```

## 3. 兩個 slot 的租約

遠端 branch 不是永久環境，而是一張有到期時間的租約：

```text
REMOTE_BRANCH_SLOT = 1 | 2
lease <= 60 minutes
branch name = vibeaico-pr<PR>-s<SLOT>-<SHA8>
with_data = false
persistent = false
```

控制層會拒絕：

- 第三個 managed branch；
- 已被占用的 slot；
- 不完整 exact head；
- 普通 local-safe PR 濫用付費 branch；
- 複製 Production 資料；
- 缺少開關、Access Token 或費用口令的付費建立；
- branch merge／push-to-parent。

## 4. 費用閘門

2026-09-01 重新查到的目前價格：

```text
每個 branch：US$0.01344 / hour
兩個 branch 同時：US$0.02688 / hour
不足一小時仍以一個小時計算
```

控制層固定要求口令：

```text
CONFIRM_BRANCH_COST_USD_0.01344_PER_HOUR
```

這只是程式防呆。真正建立前仍必須：

1. 重新取得 Supabase live cost；
2. 用白話告知 Owner；
3. 取得 Owner 對該精確金額的明確確認；
4. 呼叫 Supabase `confirm_cost` 取得一次性 confirmation id；
5. 才能呼叫 `create_branch`。

沒有完成這五步，狀態只能是：

```text
PLAN_ONLY
PAID_BRANCH_NOT_CREATED
```

## 5. 可稽核帳本

每個 lease 至少保存：

```text
BRANCH_ID
PROJECT_REF
BRANCH_NAME
PARENT_PROJECT_REF
PR
EXACT_HEAD
SLOT
TEST_PROFILE
REASONS
WITH_DATA=false
CREATED_AT
LEASE_EXPIRES_AT
HOURLY_COST
ESTIMATED_COST
DESTROYED_AT
CLEANUP_STATUS
```

格式：`.agents/schemas/remote-preview-branch-lease.schema.json`

只有 branch id／ref／name 都從 live branch list 消失，才能記：

```text
VERIFIED_DESTROYED
```

只送出 delete 請求時仍是：

```text
DELETE_REQUESTED
```

## 6. Plan-only workflow

檔案：`.github/workflows/remote-preview-branch-plan.yml`

它會：

```text
重新讀 live open PR
→ 驗 exact head
→ 讀 changed files
→ 判斷是否真的 REMOTE_BRANCH_REQUIRED
→ 建立 slot／名稱／租期／費用計畫
→ 上傳 JSON artifact
```

它的權限只有 read，**沒有建立 Supabase branch 的程式與秘密**。這是刻意設計，先驗證
分類與帳本，再用第一個付費 canary 觀察真實 branch 回應格式後，才加入 executor。

## 7. 第一個付費 canary 尚未執行

目前 Supabase branch inventory：

```text
development branches = 0
```

第一個 canary 的目標是：

```text
建立 data-less branch
→ 記錄 branch id/ref/status
→ 驗證 DB/Auth/Storage 都有獨立環境與憑證
→ 做最小隔離測試
→ 刪除 branch
→ 重新 list，證明 VERIFIED_DESTROYED
```

在 Owner 確認 `US$0.01344 / branch-hour` 前，不建立 branch，不產生費用。

## 8. Phase 3 仍然關閉

控制層完成不等於立刻開兩位完整 Terra。Phase 3 仍需：

```text
至少兩個健康 isolated slots
Phase 2 branch canary 成功並確實刪除
至少 3 輪沒有污染／孤兒 branch／重大回歸
remote canonical TEST、Sol Audit、merge 仍維持 max 1
```

達標前：

```text
FULL_TERRA_MAX = 1
```
