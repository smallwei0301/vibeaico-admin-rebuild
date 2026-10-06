import { z } from 'zod';
import { readJsonBody, PUBLIC_JSON_BODY_LIMIT_BYTES, handle, ok, fail, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import { consumeCode } from '@/server/verify-code';
import { DEFAULT_TENANT_SETTINGS } from '@/config/tenant-settings';
import { BUSINESS_TYPES, MODE_PRESETS } from '@/config/modes';
import { SHOP_CODE_PATTERN, SHOP_CODE_MESSAGE } from '@/lib/shop-code';

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8, '密碼至少 8 碼'),
  tenantName: z.string().min(1, '請輸入店家名稱'),
  // 與公開店家頁共用同一個規則：註冊得出來的代碼，`/s/{shopCode}` 就一定打得開。
  shopCode: z.string().regex(SHOP_CODE_PATTERN, SHOP_CODE_MESSAGE),
  // 業態：省略時寫入 LOCAL_SHOP（與 DB 預設一致）；非法值由 zod 擋成 400。
  businessType: z.enum(BUSINESS_TYPES).optional(),
});

function isDuplicateEmailError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'email_exists';
}

export const POST = handle(async (req) => {
  const b = bodySchema.parse(await readJsonBody(req, PUBLIC_JSON_BODY_LIMIT_BYTES));
  const admin = createAdminSupabase();

  const { data: dup } = await admin.from('tenants').select('id').eq('shop_code', b.shopCode).maybeSingle();
  if (dup) return fail(409, '此店家代碼已被使用', ERR.SHOPCODE_TAKEN);

  await consumeCode(b.email, b.code, 'REGISTER');

  const { data: created, error: uerr } = await admin.auth.admin.createUser({
    email: b.email, password: b.password, email_confirm: true,   // 驗證碼已確認過信箱
  });
  if (uerr) {
    if (isDuplicateEmailError(uerr)) return fail(409, 'Email 已註冊', ERR.EMAIL_TAKEN);
    throw uerr;
  }
  const userId = created.user.id;

  let tenantId: string | undefined;
  let ownerLinked = false;   // 僅 tenant_users(OWNER) 寫入成功後為 true
  try {
    const { data: t, error } = await admin.from('tenants')
      .insert({ shop_code: b.shopCode, name: b.tenantName, business_type: b.businessType ?? 'LOCAL_SHOP' }).select('id').single();
    if (error) throw error;
    tenantId = t.id;
    const { error: merr } = await admin.from('tenant_users').insert({ tenant_id: t.id, user_id: userId, role: 'OWNER' });
    if (merr) throw merr;   // 每一步都要檢查錯誤，否則會帶著半成品店家回 200
    ownerLinked = true;
    const s = DEFAULT_TENANT_SETTINGS(b.shopCode, b.tenantName);
    const { error: serr } = await admin.from('tenant_settings').insert({
      tenant_id: t.id, basic: s.basic, business: s.business, notify: s.notify,
      privacy: s.privacy, points: s.points, line: { ...s.line, channelSecret: undefined, channelAccessToken: undefined },
    });
    if (serr) throw serr;
    // 依模式贈與功能（GUIDE → TOUR_MODULE；source='GRANTED'、永久）
    const granted = MODE_PRESETS[b.businessType ?? 'LOCAL_SHOP'].grantedFeatures;
    if (granted.length > 0) {
      const { error: ferr } = await admin.from('feature_subscriptions').insert(
        granted.map((code) => ({ tenant_id: t.id, code, active: true, expires_at: null, source: 'GRANTED' })),
      );
      if (ferr) throw ferr;
    }
  } catch (e) {
    if (tenantId) {
      const { error: derr } = await admin.from('tenants').delete().eq('id', tenantId);   // 補償：刪店（cascade 清子表）
      if (derr) {
        if (ownerLinked) {
          // 刪店失敗但 owner membership 已建立：保留 auth 帳號，店家仍有可登入的 owner，可人工／重試復原；刪帳號會留下無主店家並佔住 shop_code
          console.error('[register] 補償刪店失敗，保留 auth 帳號', { tenantId, shopCode: b.shopCode, error: derr });
          throw e;
        }
        // 刪店失敗且尚無 owner membership（失敗點在 tenant_users insert）：租戶守門會回 403，保留帳號只會讓使用者
        // 同時被 email 與 shop_code 鎖死；記錄孤兒店家供人工清理，仍刪 auth 帳號釋放 email
        console.error('[register] 補償刪店失敗，孤兒店家（尚無 owner membership），仍刪除 auth 帳號', { tenantId, shopCode: b.shopCode, error: derr });
      }
    }
    await admin.auth.admin.deleteUser(userId);       // 補償：建店失敗就回滾帳號
    throw e;
  }
  return ok({ registered: true });
});
