import { describe, expect, it } from 'vitest';
import { calculateEcpayCheckMacValue, verifyEcpayCheckMacValue } from '@/server/ecpay';
import { buildPaymentMethodMutation, mapPaymentMethodRow, paymentMethodIsOnlineReady, validateGatewayCredentials } from '@/server/payment-methods';

describe('tenant payment methods (#9)', () => {
  it('uses one deterministic ECPay CheckMacValue source', () => {
    const key = 'A'.repeat(32); const iv = 'B'.repeat(16);
    const first = calculateEcpayCheckMacValue({ MerchantID: '2000132', Amount: 5, ItemName: '測試' }, key, iv);
    const second = calculateEcpayCheckMacValue({ ItemName: '測試', Amount: 5, MerchantID: '2000132', CheckMacValue: 'ignored' }, key, iv);
    expect(first).toBe(second); expect(first).toMatch(/^[0-9A-F]{64}$/);
    expect(verifyEcpayCheckMacValue({ MerchantID: '2000132', Amount: 5, ItemName: '測試', CheckMacValue: first }, key, iv)).toBe(true);
    expect(verifyEcpayCheckMacValue({ MerchantID: '2000132', Amount: 5, ItemName: '測試', CheckMacValue: 'wrong' }, key, iv)).toBe(false);
  });
  it('fails closed for malformed credentials', () => {
    expect(validateGatewayCredentials({ provider: 'ECPAY', merchantId: '2000132', hashKey: 'short', hashIv: 'short' }).ok).toBe(false);
    expect(validateGatewayCredentials({ provider: 'ECPAY', merchantId: '2000132', hashKey: 'A'.repeat(32), hashIv: 'B'.repeat(16) }).ok).toBe(true);
  });
  it('masks secrets and keeps online checkout disabled until e2e verification', () => {
    const row = { id: 'pm-a', tenant_id: 'tenant-a', method_type: 'ONLINE_PAYMENT', display_name: 'ECPay', qr_image_url: '', config: { gatewaySource: 'own', gatewaySandbox: true }, gateway_provider: 'ECPAY', gateway_merchant_id: '2000132', gateway_hash_key_enc: 'cipher-key', gateway_hash_iv_enc: 'cipher-iv', gateway_verified_at: null, connection_verified_at: '2026-08-31T00:00:00Z', e2e_verified_at: null, verification_error: null, active: true, sort_order: 0 } as const;
    const view = mapPaymentMethodRow(row);
    expect(view.gatewayHashKeySet).toBe(true); expect(view.gatewayHashIvSet).toBe(true);
    expect((view as unknown as Record<string, unknown>).gatewayHashKey).toBeUndefined();
    expect(view.connectionVerified).toBe(true); expect(view.e2eVerified).toBe(false); expect(paymentMethodIsOnlineReady(row)).toBe(false);
  });
  it('preserves existing config and encrypted secrets when update omits empty secret fields', () => {
    const row = { id: 'pm-b', tenant_id: 'tenant-a', method_type: 'ONLINE_PAYMENT', display_name: 'ECPay', qr_image_url: '', config: { gatewaySource: 'own', gatewaySandbox: true, bankName: 'x' }, gateway_provider: 'ECPAY', gateway_merchant_id: '2000132', gateway_hash_key_enc: 'cipher-key', gateway_hash_iv_enc: 'cipher-iv', gateway_verified_at: '2026-08-31T00:00:00Z', connection_verified_at: '2026-08-31T00:00:00Z', e2e_verified_at: '2026-08-31T00:00:00Z', verification_error: null, active: true, sort_order: 1 } as const;
    const update = buildPaymentMethodMutation({ methodType: 'ONLINE_PAYMENT', displayName: 'ECPay', gatewaySource: 'own' }, row);
    expect(update.gateway_hash_key_enc).toBeUndefined(); expect(update.gateway_hash_iv_enc).toBeUndefined();
    expect(update.config).toMatchObject({ gatewaySource: 'own', gatewaySandbox: true, bankName: 'x' });
    expect(update.connection_verified_at).toBeUndefined(); expect(update.e2e_verified_at).toBeUndefined();
  });
});
