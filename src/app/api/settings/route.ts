import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { decryptSecret } from '@/server/crypto';
import {
  basicSettingsSchema, businessSettingsSchema, notifySettingsSchema,
  privacySettingsSchema, pointsSettingsSchema, lineSettingsSchema,
  maskSecret, buildWebhookUrl, DEFAULT_TENANT_SETTINGS,
  type TenantSettings,
} from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';

/**
 * GET /api/settings — 回 TenantSettings。
 * 讀 tenant_settings 一列 → 各 jsonb 用對應 zod schema 補預設值 → line 兩個
 * secret 欄位一律填 maskSecret(decryptSecret(*_enc))、webhookUrl 永遠伺服器算。
 * 老店（列不存在）→ 用 DEFAULT_TENANT_SETTINGS 組預設回傳。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const settings: TenantSettings = row
    ? {
        // tenantName/shopCode 沒有 zod 預設值（必填），以目前租戶資料當保底，
        // 已存的 jsonb 值優先。
        basic: basicSettingsSchema.parse({
          tenantName: t.tenantName, shopCode: t.shopCode, ...(row.basic ?? {}),
        }),
        business: businessSettingsSchema.parse(row.business ?? {}),
        notify: notifySettingsSchema.parse(row.notify ?? {}),
        privacy: privacySettingsSchema.parse(row.privacy ?? {}),
        points: pointsSettingsSchema.parse(row.points ?? {}),
        line: lineSettingsSchema.parse(row.line ?? {}),
      }
    : DEFAULT_TENANT_SETTINGS(t.shopCode, t.tenantName);

  // 🔐 secret 欄位絕不以明文回傳；*_enc 欄位也絕不出現在回應。
  settings.line.channelSecret = maskSecret(decryptSecret(row?.line_channel_secret_enc ?? ''));
  settings.line.channelAccessToken = maskSecret(decryptSecret(row?.line_channel_access_token_enc ?? ''));
  settings.line.webhookUrl = buildWebhookUrl(APP_URL, t.shopCode);

  return ok(settings);
});

/**
 * PUT /api/settings — body = Partial<TenantSettings>（各出現的群組整包覆蓋）。
 * ⚠️ `line` 群組不在這裡處理（有專用端點 PUT /api/settings/line），出現也忽略。
 * basic.shopCode / basic.tenantName 變更時同步更新 tenants 表；shopCode 查重，
 * 重複回 409 AUTH_006。
 */
const bodySchema = z.object({
  basic: basicSettingsSchema.optional(),
  business: businessSettingsSchema.optional(),
  notify: notifySettingsSchema.optional(),
  privacy: privacySettingsSchema.optional(),
  points: pointsSettingsSchema.optional(),
  line: z.unknown().optional(), // 忽略——line 群組走專用端點
});

export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  if (b.basic && b.basic.shopCode !== t.shopCode) {
    const { data: dup } = await t.supabase
      .from('tenants')
      .select('id')
      .eq('shop_code', b.basic.shopCode)
      .neq('id', t.tenantId)
      .maybeSingle();
    if (dup) return fail(409, '此店家代碼已被使用', ERR.SHOPCODE_TAKEN);
  }

  if (b.basic && (b.basic.shopCode !== t.shopCode || b.basic.tenantName !== t.tenantName)) {
    const { error: terr } = await t.supabase
      .from('tenants')
      .update({ shop_code: b.basic.shopCode, name: b.basic.tenantName })
      .eq('id', t.tenantId);
    if (terr) throw terr;
  }

  const update: Record<string, unknown> = {};
  if (b.basic) update.basic = b.basic;
  if (b.business) update.business = b.business;
  if (b.notify) update.notify = b.notify;
  if (b.privacy) update.privacy = b.privacy;
  if (b.points) update.points = b.points;

  if (Object.keys(update).length) {
    const { error } = await t.supabase
      .from('tenant_settings')
      .upsert({ tenant_id: t.tenantId, ...update }, { onConflict: 'tenant_id' });
    if (error) throw error;
  }

  return ok();
});
