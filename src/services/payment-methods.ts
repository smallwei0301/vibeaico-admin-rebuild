import { adapt, request } from '@/lib/api';
import type { PaymentMethodView, PaymentMethodType, GatewayProvider } from '@/server/payment-methods';

export type PaymentMethodPayload = {
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
export type PaymentConnectionResult = {
  ok: boolean; verifiable: boolean; message: string; code?: string; method?: PaymentMethodView;
};
export type PaymentChargeResult = {
  ok: boolean; verifiable: boolean; state: string; code: string; message: string;
};
export const listPaymentMethods = () =>
  adapt<PaymentMethodView[]>(() => [], () => request<PaymentMethodView[]>('/api/payment-methods'));
export const createPaymentMethod = (payload: PaymentMethodPayload) =>
  adapt<PaymentMethodView | undefined>(() => undefined, () => request<PaymentMethodView>('/api/payment-methods', {
    method: 'POST', body: JSON.stringify(payload),
  }));
export const updatePaymentMethod = (id: string, payload: Partial<PaymentMethodPayload>) =>
  adapt<PaymentMethodView | undefined>(() => undefined, () => request<PaymentMethodView>('/api/payment-methods/' + id, {
    method: 'PUT', body: JSON.stringify(payload),
  }));
export const deletePaymentMethod = (id: string) =>
  adapt<void>(() => undefined, () => request<void>('/api/payment-methods/' + id, { method: 'DELETE' }));
export const togglePaymentMethodActive = (id: string, active: boolean) =>
  adapt<PaymentMethodView | undefined>(() => undefined, () => request<PaymentMethodView>('/api/payment-methods/' + id + '/toggle-active', {
    method: 'POST', body: JSON.stringify({ active }),
  }));
export const testPaymentConnection = (id: string) =>
  adapt<PaymentConnectionResult | undefined>(() => undefined, () => request<PaymentConnectionResult>('/api/payment-methods/' + id + '/test-connection', { method: 'POST' }));
export const testPaymentCharge = (id: string) =>
  adapt<PaymentChargeResult | undefined>(() => undefined, () => request<PaymentChargeResult>('/api/payment-methods/' + id + '/test-charge', { method: 'POST' }));
