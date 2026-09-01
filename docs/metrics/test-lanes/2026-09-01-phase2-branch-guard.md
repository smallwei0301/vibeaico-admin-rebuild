# Issue #104 Phase 2：Supabase Preview Branch 安全護欄

> 狀態：治理候選，沒有建立任何付費 branch
>
> Phase 1B：PR #107 已正常合併；local seed、201 integration、3 E2E 與 cleanup 已驗證

## 目的

DB／Auth／Storage 重型 PR 日後可各自使用 Supabase Preview Branch，但最多同時兩條。每條
都像借用會計費的會議室：先同意價格、寫開始與到期時間、指定關門的人，最後重新確認
房間真的退掉。

## 護欄

- parent project 只能是 TEST `nmwhwngojosmagjuvxol`。
- active lease 最多 2 條；同一 PR、slot、branch id、project ref 不得重複。
- branch name 固定 `pr-<PR>-<sha前8碼>`。
- active lease 必須有即時費率、Owner 成本確認、migration baseline 與 cleanup owner。
- lease 最長 120 分鐘；過期就必須 cleanup。
- token、key、service role、password 等秘密欄位不得提交。
- `delete requested` 只能記 `REQUESTED_UNVERIFIED`；live branch list 看不到才是 `VERIFIED_DESTROYED`。
- Phase 3 雙 Terra 需 Phase 1B、remote branch lifecycle、兩個健康 slot 與三輪觀察全過。

## Workflow 邊界

`supabase-preview-branch-guard.yml` 只驗證 metadata，不建立、reset 或刪除 branch，也不讀
access token／API key／service-role key。因此護欄可先進 main，不會偷偷產生帳單。

## 成本事實

2026-09-01 先前 live 查得 US$0.01344／小時／每條，當時 development branches 為 0。這只
是歷史參考；真正建立前必須重新取即時費率並由 Owner 明確確認。兩條都存活 120 分鐘的
歷史費率估算為 US$0.05376，實際帳單依當下費率與存活時間。

## 驗收狀態

- [x] lease policy、schema、max-two、unique identities
- [x] cost confirmation、120-minute TTL、cleanup owner
- [x] secret-like key 禁止提交
- [x] delete request 與 verified destruction 分開
- [x] Phase 3 capacity gate 測試
- [x] GitHub guard 明確不建立付費資源
- [ ] exact-head CI 與 Sol audit
- [ ] Owner 重新確認即時費率
- [ ] 建立第一條 branch，完成 smoke test，刪除並 live 驗證消失
- [ ] 完成兩槽 branch canary

## Phase 3 仍關閉

目前 `FULL_TERRA_MAX=1`。護欄進 main 不等於付費 branch lifecycle 已驗證，也不等於雙
Terra 已開啟。
