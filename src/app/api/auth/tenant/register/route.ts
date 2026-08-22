import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { consumeCode } from '@/server/verify-code';
import { DEFAULT_TENANT_SETTINGS } from '@/config/tenant-settings';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8, '密碼至少 8 碼'),
  tenantName: z.string().min(1, '請輸入店家名稱'),
  shopCode: z.string().regex(/^[a-z0-9-]+$/, '僅限小寫英文、數字、連字號'),
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
      .insert({ shop_code: b.shopCode, name: b.tenantName }).select('id').single();
    if (error) throw error;
    await admin.from('tenant_users').insert({ tenant_id: t.id, user_id: userId, role: 'OWNER' });
    const s = DEFAULT_TENANT_SETTINGS(b.shopCode, b.tenantName);
    await admin.from('tenant_settings').insert({
      tenant_id: t.id, basic: s.basic, business: s.business, notify: s.notify,
      privacy: s.privacy, points: s.points, line: { ...s.line, channelSecret: undefined, channelAccessToken: undefined },
    });
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);       // 補償：建店失敗就回滾帳號
    throw e;
  }
  return ok({ registered: true });
});
