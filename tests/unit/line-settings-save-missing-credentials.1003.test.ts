import { describe, expect, it } from 'vitest';
import { lineCredentialPresence } from '@/lib/line-credential-warnings';
import { lineSettingsPage as t } from '@/i18n/zh-TW/pages/line-settings';

const base = {
  existingSecret: '', existingToken: '',
  secretEditing: false, secretInput: '', tokenEditing: false, tokenInput: '',
};

describe('#1003 儲存後 Secret／Token 是否齊全', () => {
  it('都沒有 → 缺少（顯示警告）', () => {
    expect(lineCredentialPresence(base)).toEqual({ hasSecret: false, hasToken: false, missing: true });
  });
  it('編輯中但輸入空白 → 仍缺少', () => {
    expect(lineCredentialPresence({ ...base, secretEditing: true, secretInput: '  ', tokenEditing: true, tokenInput: '' }).missing).toBe(true);
  });
  it('已存有遮罩值的 Secret 與 Token → 齊全', () => {
    expect(lineCredentialPresence({ ...base, existingSecret: 'ab••••yz', existingToken: 'cd••••wx' }).missing).toBe(false);
  });
  it('本次重新輸入兩者 → 齊全', () => {
    expect(lineCredentialPresence({ ...base, secretEditing: true, secretInput: 's'.repeat(32), tokenEditing: true, tokenInput: 't'.repeat(120) }).missing).toBe(false);
  });
  it('只有 Token → 缺少', () => {
    const r = lineCredentialPresence({ ...base, existingToken: 'cd••••wx' });
    expect(r).toEqual({ hasSecret: false, hasToken: true, missing: true });
  });
  it('警告文案存在', () => {
    expect(t.form.savedMissingCredentials).toContain('尚未連線');
  });
});
