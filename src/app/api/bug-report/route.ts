// POST /api/bug-report — 問題回報（04 分冊 §B-6 MVP：寫 bug_reports 表＋寄信
// 給平台管理者）。body：{ category?, subject, content, contactEmail?, pageUrl? }。
//
// - 先 requireTenant()：本端點掛在店家後台（有租戶脈絡），reporter 存登入者 email。
// - bug_reports 是平台級表（0012）：RLS enable 且**無 policy** = service role 專用，
//   店家的 session client 寫不進去，因此這裡例外地用 createAdminSupabase() 寫入
//   （權限已由 requireTenant() 把關，tenant_id 也由伺服器端填入，不受 RLS 影響隔離）。
// - 寄信：src/server/email/send.ts 的通用 send() 是模組私有（只匯出
//   sendVerificationCodeEmail / sendBookingNotifyEmail / sendProductOrderNotifyEmail
//   三個情境函式，沒有可重用的通用寄信匯出），且本任務不得修改既有檔案，故
//   MVP 先只寫表、留 log；收件人 env（PLATFORM_ADMIN_EMAIL）未定義時也是跳過
//   寄信只 log。待 send() 對外匯出後，在標註處補 fire-and-forget 寄信即可。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

const bodySchema = z.object({
  category: z.string().trim().max(50).optional(),
  subject: z.string().trim().min(1, '請輸入問題標題').max(200),
  content: z.string().trim().min(1, '請輸入問題描述').max(5000),
  contactEmail: z.string().trim().email('聯絡信箱格式錯誤').max(200).optional(),
  pageUrl: z.string().trim().max(500).optional(),
});

/**
 * The canonical source schema currently has one free-form content column for
 * report details. Preserve the form's title and contact email there until a
 * separately authorized source migration adds first-class columns.
 */
function formatBugReportContent({
  subject,
  content,
  contactEmail,
}: Pick<z.infer<typeof bodySchema>, 'subject' | 'content' | 'contactEmail'>) {
  const metadata = [
    `問題標題：${subject}`,
    contactEmail ? `聯絡信箱：${contactEmail}` : '',
  ].filter(Boolean);
  return `${metadata.join('\n')}\n\n詳細說明：\n${content}`;
}

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { data, error } = await admin.from('bug_reports')
    .insert({
      tenant_id: t.tenantId,
      reporter: t.user.email ?? '',
      category: b.category || 'OTHER',   // 空字串/未帶 → 表預設語意 'OTHER'
      content: formatBugReportContent(b),
      page_url: b.pageUrl ?? '',
    })
    .select('id')
    .single();
  if (error) throw error;

  // fire-and-forget 通知平台管理者。send() 尚未匯出（見檔頭註解）→ 先只 log；
  // 之後接線時：if (to) void sendPlainEmail(to, subject, html)。
  const to = process.env.PLATFORM_ADMIN_EMAIL;
  if (!to) {
    console.warn('[bug-report] PLATFORM_ADMIN_EMAIL 未設定，跳過通知信。report id:', data.id);
  } else {
    console.warn('[bug-report] 通用寄信函式尚未匯出（src/server/email/send.ts 的 send 為模組私有），暫不寄信。report id:', data.id, '→', to);
  }

  return ok({ id: data.id });
});
