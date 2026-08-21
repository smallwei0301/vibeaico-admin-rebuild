# 08 — 總驗收清單（執行時照抄成 todo，逐項打勾）

> 每個 Phase 結束都要：`npm run typecheck` ✅、`npm run build` ✅、
> `NEXT_PUBLIC_USE_MOCK=true` 模式全站行為不變 ✅，再加該 Phase 專屬項目。

## Phase 0 — 環境（01 分冊）
- [ ] Supabase 專案建立，四組憑證取得
- [ ] `.env.local` 與 Vercel env 填妥；`.env.example` 更新
- [ ] `@supabase/supabase-js`、`@supabase/ssr`、`resend` 安裝完成
- [ ] `src/server/{http,supabase,tenant,crypto,mappers,paging}.ts` 建立
- [ ] env 全空 + mock 模式仍可 build（鐵則 10）

## Phase 1 — Schema（02 分冊）
- [ ] migrations 0001–0008 依序執行成功
- [ ] 未登入 anon 查 customers 回空（RLS）
- [ ] 重疊預約被排除約束擋下
- [ ] `bookings_view` / `customers_view` 正常
- [ ] dev seed 建立 demo-shop（選用）

## Phase 2 — 登入（03 分冊）
- [ ] 10 個 auth 端點全部實作且回信封格式
- [ ] `src/middleware.ts` 保護 `/tenant/*`，4 個認證頁例外
- [ ] `src/services/auth.ts` 建立並在 index.ts export
- [ ] 4 個認證頁接線（只動 handler，不動版面）
- [ ] 註冊→登入→登出→忘記→重設 全流程通
- [ ] 跨租戶隔離測試通過（兩帳號兩店互看不到）

## Phase 3 — 核心 API（04 分冊 §A）
- [ ] A-1 settings 7 端點（含 secret 遮罩/空字串不覆蓋規則）
- [ ] A-2 bookings 5 端點 + 狀態機
- [ ] A-3 customers 4 端點
- [ ] A-4 catalog 6 端點
- [ ] A-5 reports 3 端點
- [ ] `USE_MOCK=false` 後 11 個核心頁面正常載入真資料
- [ ] 錯誤碼表行為抽查：401/403/404/409 各測一例

## Phase 4 — 寄信（05 分冊）
- [ ] Resend key + 網域（或過渡 resend.dev）
- [ ] `src/server/email/{send,templates}.ts`
- [ ] 驗證碼信、預約通知信實際收到
- [ ] notify 開關生效；寄信失敗不影響 API

## Phase 5 — 進階 API（04 分冊 §B）
建議實作順序（前面的頁面使用率最高）：
- [ ] B-1 預約進階（available-slots、手動建立、calendar、block-times）
- [ ] B-2 服務/員工/班表 CRUD
- [ ] B-3 商品/訂單/庫存
- [ ] B-4 票券/會員/點數
- [ ] B-6 報表進階/匯出
- [ ] 每做完一組，對應頁面實測 CRUD 一輪

## Phase 5.5 — 功能商店（09 分冊）
- [ ] migration 0011（訂閱欄位擴充 + subscribe_feature rpc + ai jsonb）
- [ ] `FEATURE_CATALOG`（22 項）移入 `src/config/features.ts`
- [ ] 訂閱/續訂/取消/恢復 + 套裝 LITE/PRO + 升級規則
- [ ] `src/server/features.ts` 閘門 + 對應表逐條套用（3 位員工上限、20 組關鍵字、EXTRA_PUSH 額度 700）
- [ ] cron feature-expiry 副作用與 restore 自動還原
- [ ] 點數儲值 MVP（501 + 客服文案）；金流供應商決策留待平台擁有者
- [ ] AI 客服（選配）：ai-settings 儲存 + webhook AI 回覆 + UNSURE 轉人工

## Phase 6 — LINE（06 分冊）
- [ ] `src/server/line.ts`、webhook route、簽章驗證
- [ ] follow/message 事件處理 + keyword replies + 預設回覆
- [ ] chat 頁雙向訊息
- [ ] 預約狀態推播 + 額度控管
- [ ] rich menu 基本建立/發布
- [ ] verify 五項檢查

## Phase 7 — 收尾（07 分冊)
- [ ] `vercel.json` 四個 cron + `CRON_SECRET` 保護
- [ ] `/api/upload` 圖片上傳
- [ ] 上線前檢查表全過
- [ ] `NEXT_PUBLIC_USE_MOCK=false` 正式切換

## 端對端情境（最終驗收，全部在正式站操作）
1. 新店註冊 → 收驗證碼信 → 開店 → 登入
2. 設定：店家資訊、營業時間、儲存後重整仍在
3. 建服務、員工（綁服務）、手動建顧客
4. 手動建預約 → 確認 → 完成 → 顧客點數正確累積
5. 設定 LINE channel → verify 通過 → 加好友收到歡迎訊息
6. 傳「預約」關鍵字 → 收到公開頁連結；後台 chat 看得到訊息
7. 綁定顧客 LINE → 再建一筆預約並確認 → LINE 收到通知
8. 第二家店註冊 → 看不到第一家店任何資料
9. 忘記密碼 → 重設 → 新密碼登入
10. Dashboard 數字與實際資料一致
