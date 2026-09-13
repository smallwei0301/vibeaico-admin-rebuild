// tests/unit/preview-url-policy.27.test.ts
//
// Issue #27 驗收工作流的 Preview 網址前置檢查（scripts/ci/preview-url-policy.mjs）。
//
// 這支測試守的是「會不會放行不該放行的目標」，所以拒絕面的案例都指名道姓：
// 正式別名、main 分支別名、http://、非 vercel 網域、空字串，以及「只是包含專案
// 名稱」的相似主機。放行面則用兩個實際存在的 Preview 網址。

import { describe, expect, it } from 'vitest';
import {
  MAIN_BRANCH_ALIAS_SUFFIX,
  PRODUCTION_ALIAS_HOST,
  PROJECT_SCOPE_SUFFIX,
  PROJECT_SLUG,
  assertPreviewUrl,
  validatePreviewUrl,
} from '../../scripts/ci/preview-url-policy.mjs';

/** 實際存在的兩個 Preview 網址（一個部署網址、一個分支別名） */
const DEPLOYMENT_URL = `https://${PROJECT_SLUG}-5rmpsuh0k-${PROJECT_SCOPE_SUFFIX}`;
const BRANCH_ALIAS_URL = `https://${PROJECT_SLUG}-git-previe-5d731e-${PROJECT_SCOPE_SUFFIX}`;

describe('#27 Preview 網址前置檢查：放行', () => {
  it('接受實際的部署網址與分支別名', () => {
    expect(validatePreviewUrl(DEPLOYMENT_URL)).toMatchObject({
      valid: true,
      host: `${PROJECT_SLUG}-5rmpsuh0k-${PROJECT_SCOPE_SUFFIX}`,
      reason: 'DEPLOYMENT_URL',
    });
    expect(validatePreviewUrl(BRANCH_ALIAS_URL)).toMatchObject({
      valid: true,
      host: `${PROJECT_SLUG}-git-previe-5d731e-${PROJECT_SCOPE_SUFFIX}`,
      reason: 'BRANCH_ALIAS',
    });
  });

  it('容忍前後空白與結尾斜線', () => {
    expect(validatePreviewUrl(`  ${DEPLOYMENT_URL}/  `).valid).toBe(true);
    expect(assertPreviewUrl(BRANCH_ALIAS_URL)).toBe(`${PROJECT_SLUG}-git-previe-5d731e-${PROJECT_SCOPE_SUFFIX}`);
  });
});

describe('#27 Preview 網址前置檢查：拒絕', () => {
  it('拒絕正式（Production）別名，且理由指名是正式站', () => {
    const result = validatePreviewUrl(`https://${PRODUCTION_ALIAS_HOST}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('PRODUCTION_ALIAS');
    expect(result.message).toContain('正式');
  });

  it('拒絕 main 分支別名', () => {
    const result = validatePreviewUrl(
      `https://${PROJECT_SLUG}-${MAIN_BRANCH_ALIAS_SUFFIX}-${PROJECT_SCOPE_SUFFIX}`,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MAIN_BRANCH_ALIAS');
    expect(result.message).toContain('main');
  });

  it('拒絕 http://（即使主機名稱本身是合法的 Preview）', () => {
    const result = validatePreviewUrl(DEPLOYMENT_URL.replace('https://', 'http://'));
    expect(result).toMatchObject({ valid: false, reason: 'NOT_HTTPS' });
  });

  it('拒絕非 vercel.app 網域', () => {
    expect(validatePreviewUrl('https://vibeaico.com')).toMatchObject({ valid: false });
    expect(validatePreviewUrl(`https://${PROJECT_SLUG}.example.com`)).toMatchObject({
      valid: false,
      reason: 'NOT_PROJECT_PREVIEW_HOST',
    });
  });

  it('拒絕空輸入與非字串', () => {
    expect(validatePreviewUrl('')).toMatchObject({ valid: false, reason: 'EMPTY' });
    expect(validatePreviewUrl('   ')).toMatchObject({ valid: false, reason: 'EMPTY' });
    expect(validatePreviewUrl(undefined)).toMatchObject({ valid: false, reason: 'EMPTY' });
  });

  it('拒絕「只是包含專案名稱」的相似主機', () => {
    for (const host of [
      // 專案名稱出現在別人的網域裡
      `${PROJECT_SLUG}-5rmpsuh0k-${PROJECT_SCOPE_SUFFIX}.evil.example`,
      // 前面被加料
      `evil-${PROJECT_SLUG}-5rmpsuh0k-${PROJECT_SCOPE_SUFFIX}`,
      // 換成別人的 vercel scope
      `${PROJECT_SLUG}-5rmpsuh0k-someoneelses-projects.vercel.app`,
      // 專案名稱只是子網域字串的一部分
      `${PROJECT_SLUG}.vercel.app`,
    ]) {
      expect(validatePreviewUrl(`https://${host}`), host).toMatchObject({ valid: false });
    }
  });

  it('拒絕帶路徑、query、埠號或帳號密碼的網址', () => {
    expect(validatePreviewUrl(`${DEPLOYMENT_URL}/tenant/login`)).toMatchObject({ valid: false, reason: 'HAS_PATH' });
    expect(validatePreviewUrl(`${DEPLOYMENT_URL}/?x=1`)).toMatchObject({ valid: false, reason: 'HAS_QUERY_OR_HASH' });
    expect(validatePreviewUrl(`${DEPLOYMENT_URL}:8443`)).toMatchObject({ valid: false, reason: 'HAS_PORT' });
    expect(validatePreviewUrl(DEPLOYMENT_URL.replace('https://', 'https://u:p@')))
      .toMatchObject({ valid: false, reason: 'HAS_CREDENTIALS' });
  });

  it('assertPreviewUrl 對被拒絕的輸入丟例外', () => {
    expect(() => assertPreviewUrl(`https://${PRODUCTION_ALIAS_HOST}`)).toThrow(/Preview 網址前置檢查/);
  });
});
