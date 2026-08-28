# Owner Decision：Agent 常駐自主執行模式

- 日期：2026-08-28
- 狀態：已裁示
- canonical 執行規則：`docs/AGENT-EXECUTION.md`

## 決策

本 repo 的 agent 預設採長程自主推進：主力負責全局整合，Luna 處理互不重疊的
低風險工作，一個中大型 Issue 只由一位 Terra 完整負責，Sol 只在最後做一次高風險
唯讀審計。階段性回報不是停止點；已裁示與已授權項目不得重複詢問。

同時建立 Vibe Ai TEST project ref `nmwhwngojosmagjuvxol` 的 repo 層級長期授權，
涵蓋 open Issue 所需的 migration、schema/function、DDL/DML、reset、seed、schema cache
與整合／E2E。每次仍須驗證 project ref、記錄基線並遵守安全鎖。

任務所需秘密可從已連結 Google Drive `midao.md`／`midao.env` 或安全環境設定取得；
秘密不得寫入回覆、日誌、commit、PR 或 Issue。

## 保留界線

- Production Supabase、其他 Supabase project ref、正式付款與真實顧客通知不在授權內。
- Vercel Production 部署與會改變正式行為的 `main` 程式合併仍須明確發布授權。
- 純文件依 `docs/DOCUMENTATION-GOVERNANCE.md` 可直接進 `main`。

## 理由與影響

過去 agent 常在等待 CI、單一路線缺權限或完成一個 PR 後提前停工，也會重複詢問
已裁示題目、重複派多位模型讀同一批檔案。新規則把授權、派工、TEST 序列化、
停損與停止條件集中成一份正式文件，使後續工作不必依賴完整舊對話，也降低重讀與
無效重試造成的額度消耗。

每次實質失敗統一記入 `docs/AGENT-PLAYBOOK.md`；驗收與最終分支條件成立後，agent
可自主關閉 Issue，不必再向 Owner 詢問同一個關閉動作。
