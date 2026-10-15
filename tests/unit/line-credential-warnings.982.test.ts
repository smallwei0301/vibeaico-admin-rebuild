import { describe, expect, it } from 'vitest';
import {
  lineChannelIdWarning, lineSecretWarning, lineTokenWarning,
} from '@/lib/line-credential-warnings';

describe('#982 lineChannelIdWarning（先 trim 再判斷）', () => {
  it('前後空白或換行的數字 ID 不警告', () => {
    expect(lineChannelIdWarning('1234567890 ')).toBeNull();
    expect(lineChannelIdWarning('1234567890\n')).toBeNull();
    expect(lineChannelIdWarning('  \t1234567890\r\n')).toBeNull();
  });
  it('空字串或只有空白視為保留原值', () => {
    expect(lineChannelIdWarning('')).toBeNull();
    expect(lineChannelIdWarning('  \n')).toBeNull();
  });
  it('網址', () => {
    expect(lineChannelIdWarning(' https://developers.line.biz/ ')).toEqual({ kind: 'url' });
  });
  it('非數字', () => {
    expect(lineChannelIdWarning('abc123')).toEqual({ kind: 'notNumber' });
    expect(lineChannelIdWarning(' 12 34 ')).toEqual({ kind: 'notNumber' });
  });
});

describe('#982 lineSecretWarning', () => {
  const s32 = 'a'.repeat(32);
  it('32 字元 secret 前後有空白不警告', () => {
    expect(lineSecretWarning(` ${s32}\n`, true)).toBeNull();
  });
  it('31 字元警告並附 trim 後長度', () => {
    expect(lineSecretWarning('a'.repeat(31), true)).toEqual({ kind: 'tooShort', length: 31 });
    expect(lineSecretWarning(` ${'a'.repeat(31)} `, true)).toEqual({ kind: 'tooShort', length: 31 });
  });
  it('只有空白不警告（保留原值）', () => {
    expect(lineSecretWarning('   \n', true)).toBeNull();
    expect(lineSecretWarning('', true)).toBeNull();
  });
  it('未編輯不警告', () => {
    expect(lineSecretWarning('abc', false)).toBeNull();
  });
  it('網址', () => {
    expect(lineSecretWarning('https://example.com', true)).toEqual({ kind: 'url' });
  });
});

describe('#982 lineTokenWarning', () => {
  it('99 字元警告、100 字元通過（含前後空白）', () => {
    expect(lineTokenWarning('t'.repeat(99), true)).toEqual({ kind: 'tooShort', length: 99 });
    expect(lineTokenWarning('t'.repeat(100), true)).toBeNull();
    expect(lineTokenWarning(`\n ${'t'.repeat(100)} \n`, true)).toBeNull();
    expect(lineTokenWarning(` ${'t'.repeat(99)} `, true)).toEqual({ kind: 'tooShort', length: 99 });
  });
  it('只有空白或未編輯不警告', () => {
    expect(lineTokenWarning('  ', true)).toBeNull();
    expect(lineTokenWarning('x', false)).toBeNull();
  });
  it('網址', () => {
    expect(lineTokenWarning('http://x', true)).toEqual({ kind: 'url' });
  });
});
