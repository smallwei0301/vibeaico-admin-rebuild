import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '../../src/i18n/zh-TW/common';

const widget = readFileSync(
  fileURLToPath(new URL('../../src/components/layout/SupportChatWidget.tsx', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('SupportChatWidget unavailable state', () => {
  it('does not keep a local fake-send path or a fake assistant reply', () => {
    expect(widget).not.toMatch(/setMessages|const\s+send\s*=|role:\s*['"]user['"]|role:\s*['"]assistant['"]|toast\.show/);
  });

  it('keeps the composer disabled and renders the i18n unavailable notice', () => {
    expect(widget).toMatch(/<Input[\s\S]*?disabled[\s\S]*?\/>/);
    expect(widget).toMatch(/<Button[^>]*disabled/);
    expect(widget).toMatch(/common\.supportChat\.notBuiltTitle/);
    expect(widget).toMatch(/common\.supportChat\.notBuiltBody/);
    expect(widget).not.toMatch(/['"`][^'"`]*[一-鿿][^'"`]*['"`]/);
  });

  it('states that the backend is unavailable and the message is not sent', () => {
    expect(common.supportChat.notBuiltTitle).toContain('尚未開通');
    expect(common.supportChat.notBuiltBody).toContain('尚未建置');
    expect(common.supportChat.notBuiltBody).toContain('不會送出');
    expect(common.supportChat.disabledPlaceholder).toContain('尚未開通');
    expect(Object.keys(common.supportChat)).not.toContain('greeting');
  });
});
