import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const key = () => Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, 'hex'); // 32 bytes

/** AES-256-GCM。輸出格式：iv(hex).tag(hex).cipher(hex)，存 DB 的 text 欄位 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}.${c.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  const [iv, tag, data] = stored.split('.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
}
