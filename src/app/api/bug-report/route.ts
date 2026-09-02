// POST /api/bug-report — 問題回報（04 分冊 §B-6 MVP：寫 bug_reports 表＋寄信
// 給平台管理者）。body：{ category?, subject, content, contactEmail?, pageUrl? }。
//
// subject / contact_email 是 migration 0018 補的欄位（issue #28 第 ① 筆）：modal
// 收四個欄位，0012 建表時只有 category/content 有落點，另兩個沒有地方放。不併進
// content 是刻意的，否則無法逐欄驗證使用者輸入是否真的被收集。
// TEST 與 Production 的欄位已在 2026-09-02 以唯讀 information_schema 查詢確認一致；
// 本端點只使用既有欄位，不執行任何 schema 變更。
//
// - 先 requireTenant()：本端點掛在店家後台（有租戶脈絡），reporter 存登入者 email。
// - bug_reports 是平台級表（0012）：RLS enable 且無店家 policy，故使用
//   createAdminSupabase() 寫入；權限與 tenant_id 均由伺服器端決定。
// - 寄信：src/server/email/send.ts 的通用 send() 尚未匯出，MVP 先只寫表並留下
//   誠實 log，不宣稱平台已收到通知信。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

const bodySchema = z.object({
  category: z.string().trim().max(50).optional(),
  subject: z.string().trim().min(1, '請輸入問題標題').max(200),
  content: z.string().trim().min(1, '請輸入問題描述').max(5000),
  // 回報者自填的回覆信箱與登入帳號（reporter）分開保存；沒填就存空字串。
  contactEmail: z.string().trim().email('聯絡信箱格式錯誤').max(200).optional(),
  pageUrl: z.string().trim().max(500).optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { data, error } = await admin.from('bug_reports')
    .insert({
      tenant_id: t.tenantId,
      reporter: t.user.email ?? '',
      category: b.category || 'OTHER',
      subject: b.subject,
      content: b.content,
      contact_email: b.contactEmail ?? '',
      page_url: b.pageUrl ?? '',
    })
    .select('id')
    .single();
  if (error) throw error;

  const to = process.env.PLATFORM_ADMIN_EMAIL;
  if (!to) {
    console.warn('[bug-report] PLATFORM_ADMIN_EMAIL 未設定，跳過通知信。report id:', data.id);
  } else {
    console.warn('[bug-report] 通用寄信函式尚未匯出，暫不寄信。report id:', data.id, '→', to);
  }

  return ok({ id: data.id });
});
