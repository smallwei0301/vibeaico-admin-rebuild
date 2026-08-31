import { createHash } from 'crypto';

export function calculateEcpayCheckMacValue(
  params: Record<string, string | number | boolean | null | undefined>,
  hashKey: string,
  hashIv: string,
): string {
  const pairs = Object.entries(params)
    .filter(([key, value]) => key.toLowerCase() !== 'checkmacvalue' && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()));
  const raw = [
    'HashKey=' + hashKey,
    ...pairs.map(([key, value]) => key + '=' + value),
    'HashIV=' + hashIv,
  ].join('&');
  const encoded = encodeURIComponent(raw).toLowerCase()
    .replace(/%2d/g, '-').replace(/%5f/g, '_').replace(/%2e/g, '.')
    .replace(/%21/g, '!').replace(/%2a/g, '*')
    .replace(/%28/g, '(').replace(/%29/g, ')');
  return createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase();
}

export function verifyEcpayCheckMacValue(
  params: Record<string, string | number | boolean | null | undefined>,
  hashKey: string,
  hashIv: string,
): boolean {
  const supplied = Object.entries(params).find(([key]) => key.toLowerCase() === 'checkmacvalue')?.[1];
  if (typeof supplied !== 'string' || !supplied) return false;
  return calculateEcpayCheckMacValue(params, hashKey, hashIv).toLowerCase() === supplied.toLowerCase();
}
