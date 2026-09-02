import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GUIDE bottom navigation (#66 Phase I/J)', () => {
  it('keeps long labels readable and keyboard focus visible', () => {
    const source = readFileSync('src/components/guide/GuideBottomNav.tsx', 'utf8');

    expect(source).toContain('safe-area-inset-bottom');
    expect(source).toContain('GUIDE_UI_CLASSES.focusRing');
    expect(source).toContain('break-words');
    expect(source).toContain('whitespace-normal');
    expect(source).not.toContain('truncate');
    expect(source).toContain('guideNavigation.primaryLabel');
    expect(source).not.toContain('GUIDE primary');
  });
});
