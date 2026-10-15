import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  { name: 'onboarding', path: 'src/app/tenant/line-settings/onboarding/page.tsx', fn: 'saveCredentials', busy: 'savingCredentials' },
  { name: 'line-settings', path: 'src/app/tenant/line-settings/page.tsx', fn: 'saveLine', busy: 'savingLine' },
];

describe('#982 LINE 憑證格式警告時不送出儲存', () => {
  for (const p of pages) {
    const src = readFileSync(p.path, 'utf8');
    const start = src.indexOf(`const ${p.fn} = async`);
    const body = src.slice(start, src.indexOf('saveLineSettings(', start));

    it(`${p.name}: ${p.fn} 在 saveLineSettings 前檢查三個 warning`, () => {
      expect(start).toBeGreaterThan(-1);
      expect(body).toMatch(/channelIdWarning/);
      expect(body).toMatch(/secretWarning/);
      expect(body).toMatch(/tokenWarning/);
      expect(body).toMatch(/toast\.show\(credentialWarning, 'warning'\)/);
    });

    it(`${p.name}: 儲存鈕 disabled 條件包含 warning`, () => {
      expect(src).toMatch(
        new RegExp(`loading=\\{${p.busy}\\}\\s+disabled=\\{!!\\(channelIdWarning \\|\\| secretWarning \\|\\| tokenWarning\\)\\}`),
      );
    });

    it(`${p.name}: 無中文字面量`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/[一-鿿]/);
    });
  }
});
