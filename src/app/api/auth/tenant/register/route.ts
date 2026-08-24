import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { consumeCode } from '@/server/verify-code';
import { DEFAULT_TENANT_SETTINGS } from '@/config/tenant-settings';
import { BUSINESS_TYPES } from '@/config/modes';
import { PAID_FEATURE_CODES } from '@/config/features';
import { seedDemoData } from '@/server/demo-seed';

/** 新店家的全功能試用天數：期間內所有付費功能可用，到期由 feature-expiry cron 收回。 */
const TRIAL_DAYS = 7;

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8, '密碼至少 8 碼'),
  tenantName: z.string().min(1, '請輸入店家名稱'),
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號'),
  // 註冊頁早就讓店家三選一（13 分冊），但先前沒有欄位可存、也沒進 payload，
  // 導致真實註冊的店家一律變成 LOCAL_SHOP。選填是為了相容舊呼叫端。
  businessType: z.enum(BUSINESS_TYPES).optional(),
});

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();

  const { data: dup } = await admin.from('tenants').select('id').eq('shop_code', b.shopCode).maybeSingle();
  if (dup) return fail(409, '此店家代碼已被使用', ERR.SHOPCODE_TAKEN);

  await consumeCode(b.email, b.code, 'REGISTER');

  const { data: created, error: uerr } = await admin.auth.admin.createUser({
    email: b.email, password: b.password, email_confirm: true,   // 驗證碼已確認過信箱
  });
  if (uerr) return fail(409, 'Email 已註冊', ERR.EMAIL_TAKEN);
  const userId = created.user.id;

  try {
    const { data: t, error } = await admin.from('tenants')
      .insert({
        shop_code: b.shopCode,
        name: b.tenantName,
        business_type: b.businessType ?? 'LOCAL_SHOP',
      }).select('id').single();
    if (error) throw error;
    await admin.from('tenant_users').insert({ tenant_id: t.id, user_id: userId, role: 'OWNER' });
    const s = DEFAULT_TENANT_SETTINGS(b.shopCode, b.tenantName);
    await admin.from('tenant_settings').insert({
      tenant_id: t.id, basic: s.basic, business: s.business, notify: s.notify,
      privacy: s.privacy, points: s.points, line: { ...s.line, channelSecret: undefined, channelAccessToken: undefined },
    });

    // 新店試用期：全部付費功能開通 TRIAL_DAYS 天。沒有這段的話，新店家一進後台
    // 每個受閘門保護的端點都回 403 FEAT_001，畫面會被「此功能尚未訂閱」灌爆，
    // 等於什麼都不能試。到期後由既有的 feature-expiry cron 依 expires_at 收回，
    // 不需要額外的清理機制。source 標 'TRIAL' 以便與付費/贈送訂閱區分。
    const trialExpiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await admin.from('feature_subscriptions').insert(
      PAID_FEATURE_CODES.map((code) => ({
        tenant_id: t.id, code, active: true,
        expires_at: trialExpiresAt, source: 'TRIAL', started_at: new Date().toISOString(),
      })),
    );
    // 依業態鋪示範資料（三個服務／行程、一位員工、三個商品），讓新店家一進
    // 後台就有東西可看可改，首頁提供「一鍵清空」整批移除。示範資料失敗不該
    // 讓註冊失敗——店開好了才是關鍵，範例資料之後可從首頁自行補上。
    try {
      await seedDemoData(t.id, b.businessType ?? 'LOCAL_SHOP');
    } catch (seedErr) {
      console.error('[register] 示範資料建立失敗（不影響註冊）', seedErr);
    }
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);       // 補償：建店失敗就回滾帳號
    throw e;
  }
  return ok({ registered: true });
});
