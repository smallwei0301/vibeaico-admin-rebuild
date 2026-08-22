import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64);
});

import { encryptSecret, decryptSecret } from '@/server/crypto';

describe('crypto — encryptSecret / decryptSecret (01 §5.4)', () => {
  it('encrypt→decrypt 還原', () => {
    const plain = 'my-line-channel-secret-123';
    const cipher = encryptSecret(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it('空字串：encryptSecret 回空字串、decryptSecret 回空字串', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('壞密文丟錯', () => {
    expect(() => decryptSecret('not-a-valid-ciphertext')).toThrow();
    expect(() => decryptSecret('aaaa.bbbb.cccc')).toThrow();
  });

  it('不同 iv 產不同密文，但都能解回同樣明文', () => {
    const plain = 'same-plaintext-value';
    const c1 = encryptSecret(plain);
    const c2 = encryptSecret(plain);
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe(plain);
    expect(decryptSecret(c2)).toBe(plain);
  });
});
