import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const modal = read('src/components/layout/BugReportModal.tsx');
const service = read('src/services/bug-report.ts');
const route = read('src/app/api/bug-report/route.ts');
const common = read('src/i18n/zh-TW/common.ts');

describe('BugReportModal #28①: the report is collected and submitted', () => {
  it('keeps every user-entered field controlled', () => {
    for (const field of ['category', 'subject', 'description', 'contactEmail']) {
      const setter = `set${field[0].toUpperCase()}${field.slice(1)}`;
      expect(modal).toContain(`const [${field}, ${setter}] = React.useState`);
    }
    for (const id of ['bugCategory', 'bugSubject', 'bugDesc', 'bugEmail']) {
      const start = modal.indexOf(`id="${id}"`);
      const end = modal.indexOf('>', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(modal.slice(start, end)).toMatch(/value=\{/);
      expect(modal.slice(start, end)).toMatch(/onChange=\{/);
    }
    expect(modal).not.toContain('defaultValue');
  });

  it('awaits the service and only shows success after the API resolves', () => {
    const submit = modal.slice(modal.indexOf('const submit'), modal.indexOf('return ('));
    expect(submit).not.toContain('setTimeout');
    expect(submit).toContain('await submitBugReport({');
    expect(submit).toContain('subject: subject.trim()');
    expect(submit).toContain('content: description.trim()');
    expect(submit).toContain('contactEmail: contactEmail.trim() || undefined');
    expect(submit.indexOf('await submitBugReport(')).toBeLessThan(
      submit.indexOf('toast.show(t.submitted)'),
    );
    expect(submit).toContain("'danger'");
  });

  it('uses the service boundary instead of fetching from the layout component', () => {
    expect(modal).toContain("import { submitBugReport } from '@/services/bug-report';");
    expect(modal).not.toMatch(/fetch\(/);
    expect(service).toContain("request<{ id: string }>('/api/bug-report'");
    expect(service).toContain("method: 'POST'");
  });

  it('writes the four form values into their first-class database columns', () => {
    expect(route).toContain('category: b.category || \'OTHER\'');
    expect(route).toContain('subject: b.subject');
    expect(route).toContain('content: b.content');
    expect(route).toContain("contact_email: b.contactEmail ?? ''");
    expect(route).not.toContain('formatBugReportContent');
  });

  it('keeps user-facing Chinese in the i18n dictionary instead of the component', () => {
    const executableModal = withoutComments(modal);
    const cjk = executableModal.match(/[一-鿿　-〿＀-￯]/g);
    expect(cjk ?? [], `仍有硬編碼中文字面量：${(cjk ?? []).join('')}`).toEqual([]);
    expect(common).toContain("submitted: '已收到您的回報，感謝協助！'");
    expect(executableModal).toContain('toast.show(t.submitted)');
    expect(executableModal).toContain('t.submitFailed');
  });

  it('does not claim screenshot persistence that is not implemented', () => {
    const start = modal.indexOf('id="bugShot"');
    const end = modal.indexOf('/>', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(modal.slice(start, end)).toContain('disabled');
    expect(common).toContain('screenshotNotBuilt');
  });
});
