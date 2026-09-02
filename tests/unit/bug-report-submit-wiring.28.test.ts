import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

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

  it('preserves subject and contact email in the current schema content column', () => {
    expect(route).toContain('content: formatBugReportContent(b)');
    expect(route).toContain('問題標題：${subject}');
    expect(route).toContain('聯絡信箱：${contactEmail}');
    expect(route).not.toContain('subject: b.subject');
    expect(route).not.toContain('contact_email:');
  });

  it('does not claim screenshot persistence that is not implemented', () => {
    const start = modal.indexOf('id="bugShot"');
    const end = modal.indexOf('/>', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(modal.slice(start, end)).toContain('disabled');
    expect(common).toContain('screenshotNotBuilt');
  });
});
