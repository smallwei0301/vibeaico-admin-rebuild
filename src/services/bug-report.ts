/**
 * Service boundary for the global bug-report modal.
 * Pages and layout components do not call fetch directly.
 */
import { adapt, delay, request } from '@/lib/api';

export type BugReportInput = {
  category?: string;
  subject: string;
  content: string;
  contactEmail?: string;
  pageUrl?: string;
};

let nextMockId = 1;

export const submitBugReport = (input: BugReportInput) =>
  adapt<{ id: string }>(
    async () => {
      await delay();
      return { id: `br_mock_${nextMockId++}` };
    },
    () => request<{ id: string }>('/api/bug-report', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
