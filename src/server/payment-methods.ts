import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from './crypto';

export const PAYMENT_METHOD_TYPES = [
  'LINE_PAY', 'JKOPAY', 'BANK_TRANSFER', 'CASH', 'ONLINE_PAYMENT', 'OTHER',
] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];
export const GATEWAY_PROVIDERS = ['NEWEBPAY', 'ECPAY'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export type PaymentMethodInput = {
  methodType: PaymentMethodType;
  displayName: string;
  qrImageUrl?: string;
  bankName?: string;
  bankCode?: string;
  accountNumber?: string;
  accountHolderName?: string;
  gatewaySource?: 'own' | 'demo';
  gatewayProvider?: GatewayProvider;
  gatewayMerchantId?: string;
  gatewayHashKey?: string;
  gatewayHashIv?: string;
  gatewaySandbox?: boolean;
  sortOrder?: number;
  active?: boolean;
  instructions?: string;
};

export type PaymentMethodView = {
  id: string;
  methodType: PaymentMethodType;
  displayName: string;
  qrImageUrl: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  gatewaySource: 'own' | 'demo';
  gatewayProvider: GatewayProvider;
  gatewayMerchantId: string;
  gatewayHashKeySet: boolean;
  gatewayHashIvSet: boolean;
  gatewaySandbox: boolean;
  gatewayVerified: boolean;
  connectionVerified: boolean;
  e2eVerified: boolean;
  verificationError: string | null;
  sortOrder: number;
  active: boolean;
  instructions: string;
};

export type PaymentMethodRow = {
  id: string;
  tenant_id: string;
  method_type: PaymentMethodType;
  display_name: string;
  qr_image_url: string;
  config: Record<string, unknown> | null;
  gateway_provider: GatewayProvider | null;
  gateway_merchant_id: string;
  gateway_hash_key_enc: string;
  gateway_hash_iv_enc: string;
  gateway_verified_at: string | null;
  connection_verified_at: string | null;
  e2e_verified_at: string | null;
  verification_error: string | null;
  active: boolean;
  sort_order: number;
};

const configText = (config: Record<string, unknown> | null | undefined, key: string) => {
  const value = config?.[key];
  return typeof value === 'string' ? value : '';
};
const configBool = (config: Record<string, unknown> | null | undefined, key: string) => config?.[key] === true;

export function mapPaymentMethodRow(row: PaymentMethodRow): PaymentMethodView {
  const config = row.config ?? {};
  const gatewaySource = configText(config, 'gatewaySource') === 'demo' ? 'demo' : 'own';
  return {
    id: row.id,
    methodType: row.method_type,
    displayName: row.display_name,
    qrImageUrl: row.qr_image_url,
    bankName: configText(config, 'bankName'),
    bankCode: configText(config, 'bankCode'),
    accountNumber: configText(config, 'accountNumber'),
    accountHolderName: configText(config, 'accountHolderName'),
    gatewaySource,
    gatewayProvider: row.gateway_provider ?? 'ECPAY',
    gatewayMerchantId: row.gateway_merchant_id,
    gatewayHashKeySet: Boolean(row.gateway_hash_key_enc),
    gatewayHashIvSet: Boolean(row.gateway_hash_iv_enc),
    gatewaySandbox: configBool(config, 'gatewaySandbox'),
    gatewayVerified: Boolean(row.e2e_verified_at ?? row.gateway_verified_at),
    connectionVerified: Boolean(row.connection_verified_at),
    e2eVerified: Boolean(row.e2e_verified_at ?? row.gateway_verified_at),
    verificationError: row.verification_error,
    sortOrder: row.sort_order,
    active: row.active,
    instructions: configText(config, 'instructions'),
  };
}

export function validateGatewayCredentials(input: {
  provider?: GatewayProvider;
  merchantId?: string;
  hashKey?: string;
  hashIv?: string;
}) {
  const merchantId = input.merchantId?.trim() ?? '';
  const hashKey = input.hashKey?.trim() ?? '';
  const hashIv = input.hashIv?.trim() ?? '';
  if (!input.provider) return { ok: false, message: '請選擇金流服務商' };
  if (!merchantId) return { ok: false, message: '請輸入商店代號' };
  if (!hashKey || hashKey.length !== 32) return { ok: false, message: 'HashKey 必須是 32 字元' };
  if (!hashIv || hashIv.length !== 16) return { ok: false, message: 'HashIV 必須是 16 字元' };
  return { ok: true as const };
}

function configFromInput(input: PaymentMethodInput, current?: PaymentMethodRow | null) {
  const old = current?.config ?? {};
  const value = (next: string | undefined, key: string) =>
    next === undefined ? configText(old, key) : next.trim();
  return {
    bankName: value(input.bankName, 'bankName'),
    bankCode: value(input.bankCode, 'bankCode'),
    accountNumber: value(input.accountNumber, 'accountNumber'),
    accountHolderName: value(input.accountHolderName, 'accountHolderName'),
    instructions: value(input.instructions, 'instructions'),
    gatewaySource: input.gatewaySource === undefined
      ? (configText(old, 'gatewaySource') === 'demo' ? 'demo' : 'own')
      : (input.gatewaySource === 'demo' ? 'demo' : 'own'),
    gatewaySandbox: input.gatewaySandbox === undefined
      ? configBool(old, 'gatewaySandbox')
      : input.gatewaySandbox === true,
  };
}

function gatewayChanged(input: PaymentMethodInput, current?: PaymentMethodRow | null) {
  if (!current) return true;
  const oldConfig = current.config ?? {};
  const suppliedHashKey = input.gatewayHashKey?.trim() ?? '';
  const suppliedHashIv = input.gatewayHashIv?.trim() ?? '';
  return (
    (input.gatewayProvider !== undefined && input.gatewayProvider !== current.gateway_provider)
    || (input.gatewayMerchantId !== undefined && input.gatewayMerchantId.trim() !== current.gateway_merchant_id)
    || suppliedHashKey !== ''
    || suppliedHashIv !== ''
    || (input.gatewaySource !== undefined && input.gatewaySource !== configText(oldConfig, 'gatewaySource'))
  );
}

export function buildPaymentMethodMutation(input: PaymentMethodInput, current?: PaymentMethodRow | null) {
  const methodType = input.methodType;
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('請輸入顯示名稱');
  const source = input.gatewaySource
    ?? (configText(current?.config, 'gatewaySource') === 'demo' ? 'demo' : 'own');
  const provider = input.gatewayProvider ?? current?.gateway_provider ?? undefined;
  const merchantId = input.gatewayMerchantId ?? current?.gateway_merchant_id ?? '';
  if (methodType === 'ONLINE_PAYMENT' && source !== 'demo') {
    if (!current && !validateGatewayCredentials({
      provider, merchantId, hashKey: input.gatewayHashKey, hashIv: input.gatewayHashIv,
    }).ok) {
      const result = validateGatewayCredentials({
        provider, merchantId, hashKey: input.gatewayHashKey, hashIv: input.gatewayHashIv,
      });
      throw new Error(result.message);
    }
    if (!provider) throw new Error('請選擇金流服務商');
    if (!merchantId.trim()) throw new Error('請輸入商店代號');
    if (current && !current.gateway_hash_key_enc && !input.gatewayHashKey?.trim())
      throw new Error('請輸入 HashKey');
    if (current && !current.gateway_hash_iv_enc && !input.gatewayHashIv?.trim())
      throw new Error('請輸入 HashIV');
  }

  const update: Record<string, unknown> = {
    display_name: displayName,
    method_type: methodType,
    qr_image_url: input.qrImageUrl === undefined ? current?.qr_image_url ?? '' : input.qrImageUrl.trim(),
    config: configFromInput(input, current),
    sort_order: Math.max(0, Math.trunc(input.sortOrder ?? current?.sort_order ?? 0)),
    active: input.active ?? current?.active ?? true,
  };

  if (methodType === 'ONLINE_PAYMENT' && source !== 'demo') {
    update.gateway_provider = provider;
    update.gateway_merchant_id = merchantId.trim();
    if (input.gatewayHashKey?.trim()) update.gateway_hash_key_enc = encryptSecret(input.gatewayHashKey.trim());
    if (input.gatewayHashIv?.trim()) update.gateway_hash_iv_enc = encryptSecret(input.gatewayHashIv.trim());
  } else {
    update.gateway_provider = null;
    update.gateway_merchant_id = '';
    update.gateway_hash_key_enc = '';
    update.gateway_hash_iv_enc = '';
  }

  if (gatewayChanged({ ...input, gatewaySource: source, gatewayProvider: provider, gatewayMerchantId: merchantId }, current)) {
    update.connection_verified_at = null;
    update.e2e_verified_at = null;
    update.gateway_verified_at = null;
    update.verification_error = null;
  }
  return update;
}

export function paymentMethodIsOnlineReady(row: PaymentMethodRow) {
  return row.method_type !== 'ONLINE_PAYMENT' || Boolean(row.e2e_verified_at ?? row.gateway_verified_at);
}

export async function getPaymentMethod(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  opts: { activeOnly?: boolean; checkoutReady?: boolean } = {},
) {
  let query = supabase.from('tenant_payment_methods').select('*').eq('tenant_id', tenantId).eq('id', id);
  if (opts.activeOnly) query = query.eq('active', true);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || (opts.checkoutReady && !paymentMethodIsOnlineReady(data as PaymentMethodRow)))
    return null;
  return data as PaymentMethodRow;
}

export async function testGatewayConnection(row: PaymentMethodRow) {
  let hashKey = '';
  let hashIv = '';
  try {
    hashKey = row.gateway_hash_key_enc ? decryptSecret(row.gateway_hash_key_enc) : '';
    hashIv = row.gateway_hash_iv_enc ? decryptSecret(row.gateway_hash_iv_enc) : '';
  } catch {
    return { ok: false, verifiable: true, message: '金流密鑰無法解密，請重新輸入' } as const;
  }
  const shape = validateGatewayCredentials({
    provider: row.gateway_provider ?? undefined,
    merchantId: row.gateway_merchant_id,
    hashKey,
    hashIv,
  });
  if (!shape.ok) return { ok: false, verifiable: true, message: shape.message } as const;
  return {
    ok: false,
    verifiable: false,
    message: '金流商未提供不扣款的通用驗證端點；尚未宣稱連線已驗證',
  } as const;
}
