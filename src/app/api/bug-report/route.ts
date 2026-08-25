// POST /api/bug-report — 問題回報（04 分冊 §B-6 MVP：寫 bug_reports 表＋寄信
// 給平台管理者）。body：{ category?, subject, content, contactEmail?, pageUrl? }。
//
// subject / contact_email 是 migration 0018 補的欄位（issue #28 第 ① 筆）：modal
// 收四個欄位，0012 建表時只有 category/content 有落點，另兩個沒有地方放。不併進
// content 是刻意的——併起來就無法逐欄比對，也就無法證明「內容真的被收集了」。
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
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

/**
 * 回報截圖的落腳處（migration 0019）——**private** bucket。
 *
 * 與 `chat-images`（0017，public）的差別見 0019 檔頭與 06 分冊 §8.5：
 * chat-images 被 LINE 抓圖逼成 public，代價是網址即權限、無身分檢查；
 * 回報截圖沒有那個限制，而敏感度更高（使用者在畫面出問題的當下截圖，
 * 幾乎必然含當時螢幕上的顧客資料），所以不公開，讀取一律由伺服器端現簽。
 *
 * 這裡存的是 **bucket 內路徑**（`{tenantId}/{uuid}.{ext}`），不是 URL：
 * private bucket 的簽名 URL 會過期，存 URL 只會存出死連結。
 */
const BUG_REPORT_ATTACHMENT_BUCKET = 'bug-report-attachments';

const bodySchema = z.object({
  category: z.string().max(50).optional(),
  subject: z.string().min(1, '請輸入問題標題').max(200),
  content: z.string().min(1, '請輸入問題描述').max(5000),
  // 回報者自填的回覆信箱：與登入帳號（reporter）分開存，可能刻意留別的信箱。
  // 空字串＝沒填，照樣存空字串（表預設），不要塞 reporter 進去假裝有填。
  contactEmail: z.string().max(200).optional(),
  pageUrl: z.string().max(500).optional(),
  /**
   * `/api/upload`（bucket=bug-report-attachments）回的 `path`。空字串／未帶＝沒附截圖。
   * 下面會逐一驗證：必須是本租戶資料夾底下、而且該物件**真的存在**。
   */
  attachmentPath: z.string().max(500).optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();

  // ---- 附件驗證 ----
  // 兩件事都得驗，缺一都會存出一個「看起來有截圖、點開卻沒有」的紀錄：
  //  1. 路徑必須在本租戶資料夾下——路徑是用戶端送上來的字串，不驗就等於允許
  //     任何店家把附件指到別家店的物件（bucket 內第一段資料夾＝租戶 id，
  //     與 0008 起的 storage RLS 規則同一套）。
  //  2. 物件必須真的存在——沒有這一步，資料庫裡就會出現指向空氣的 attachment_path，
  //     正是 CLAUDE.md「Never fabricate a known」說的那種假的已知。
  const attachmentPath = (b.attachmentPath ?? '').trim();
  if (attachmentPath) {
    if (!attachmentPath.startsWith(`${t.tenantId}/`))
      throw new ApiHttpError(400, '附件路徑不屬於這家店', ERR.VALIDATION);
    const { error: infoError } = await admin.storage
      .from(BUG_REPORT_ATTACHMENT_BUCKET)
      .info(attachmentPath);
    if (infoError)
      throw new ApiHttpError(400, '找不到這個附件，請重新上傳截圖', ERR.VALIDATION);
  }

  const { data, error } = await admin.from('bug_reports')
    .insert({
      tenant_id: t.tenantId,
      reporter: t.user.email ?? '',
      category: b.category || 'OTHER',   // 空字串/未帶 → 表預設語意 'OTHER'
      subject: b.subject,
      content: b.content,
      contact_email: b.contactEmail ?? '',
      page_url: b.pageUrl ?? '',
      attachment_path: attachmentPath,
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
