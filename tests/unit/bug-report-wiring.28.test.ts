import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '@/i18n/zh-TW/common';

const MODAL = 'src/components/layout/BugReportModal.tsx';

const source = readFileSync(
  fileURLToPath(new URL('../../' + MODAL, import.meta.url)),
  'utf-8',
);

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('BugReportModal: controlled inputs and truthful submission', () => {
  const code = withoutComments(source);

  it('keeps all text fields controlled', () => {
    for (const state of ['category', 'subject', 'description', 'contactEmail']) {
      const setter = 'set' + state[0].toUpperCase() + state.slice(1);
      expect(code).toContain('const [' + state + ', ' + setter + '] = React.useState');
    }

    for (const id of ['bugCategory', 'bugSubject', 'bugDesc', 'bugEmail']) {
      const tagStart = code.indexOf('id="' + id + '"');
      expect(tagStart, 'missing id="' + id + '"').toBeGreaterThan(-1);
      const tag = code.slice(tagStart, code.indexOf('>', tagStart));
      expect(tag, id + ' has no value').toMatch(/value=\{/);
      expect(tag, id + ' has no onChange').toMatch(/onChange=\{/);
    }

    expect(code).not.toMatch(/defaultValue/);
  });

  it('calls the real service and has no fake delay', () => {
    expect(code).toMatch(/import \{ submitBugReport \} from '@\/services\/bug-report'/);
    expect(code).not.toMatch(/setTimeout/);
    expect(code).toMatch(/await submitBugReport\(/);
    expect(code).toMatch(/category:/);
    expect(code).toMatch(/subject:\s*trimmedSubject/);
    expect(code).toMatch(/content:\s*trimmedDescription/);
    expect(code).toMatch(/contactEmail:/);
  });

  it('only closes and shows success after the awaited request, while failures stay visible', () => {
    const submit = code.slice(code.indexOf('const submit'), code.indexOf('return ('));
    expect(submit.indexOf('await submitBugReport(')).toBeLessThan(submit.indexOf('close();'));
    expect(submit.indexOf('await submitBugReport(')).toBeLessThan(submit.indexOf('toast.show(t.submitted)'));
    expect(submit).toMatch(/catch[\s\S]*setError\(message\)/);
    expect(code).toMatch(/<FormError role="alert">\{error\}<\/FormError>/);
  });

  it('does not claim that unsupported screenshots were submitted', () => {
    const tagStart = code.indexOf('id="bugShot"');
    const tag = code.slice(tagStart, code.indexOf('/>', tagStart));
    expect(tag).toMatch(/disabled/);
    expect(code).toMatch(/t\.screenshotNotBuilt/);
    expect(common.bugReport.screenshotNotBuilt).toMatch(/不支援附件/);
  });
});
