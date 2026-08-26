/** issue #19：真實 LINE validate/reply 腳本不得把多訊息 outcome 偷縮成一則。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  fileURLToPath(new URL('../../scripts/verify/flex-menu-validate.cjs', import.meta.url)),
  'utf-8',
);
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('issue #19：flexShowTip 的 LINE validate/reply 證據腳本', () => {
  const code = withoutComments(script);

  it('把 outcome 的完整 messages 陣列送給 LINE，而不是已移除的 message 單數欄位', () => {
    expect(code).toContain('messages: o.messages');
    expect(code).not.toContain('message: o.message');
    expect(code).toContain('async function validate(messages)');
    expect(code).toContain('body: JSON.stringify({ messages })');
  });

  it('有 flexShowTip=true 的兩則正向案例，以及故意弄壞第二則文字的負向控制', () => {
    expect(code).toContain("flexShowTip: true");
    expect(code).toContain('兩則訊息');
    expect(code).toMatch(/\[1\]\.text = ''/);
    expect(code).toContain('第二則');
  });

  it('每一個既有負向控制都以非空訊息陣列送進 validate，第二則控制才跑得到', () => {
    const negative = code.slice(code.indexOf('const neg = ['), code.indexOf('/*\n * ------------------------------------------------------------ scheme'));
    expect(negative).toContain("['uri action 用 javascript:', [withScheme('javascript:alert(1)')]]");
    expect(negative).toContain("['uri action 用 data:', [withScheme('data:text/html,x')]]");
    expect(negative).toContain("['uri action 用 ftp:', [withScheme('ftp://a.example/')]]");
    expect(negative).toContain("['hero 圖 url 用 http —— issue #6 留下的基準線，本輪重跑', [httpHero]]");
    // invalidTip 自己就是兩訊息陣列，不能再包一層。
    expect(negative).toContain("['flexShowTip 第二則使用提示為空字串', invalidTip]");
  });

  it('缺 token 會以非零結束，不能把未驗證誤報成通過', () => {
    expect(code).toContain("process.exit(2)");
  });
});
