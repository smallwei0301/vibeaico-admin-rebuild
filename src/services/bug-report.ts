import { ApiError, request } from '@/lib/api';

/** Fields collected by the modal before adapting to the existing report API. */
export type BugReportInput = {
  category?: string;
  subject: string;
  content: string;
  contactEmail?: string;
  pageUrl?: string;
};

/** The current /api/bug-report contract only accepts these fields. */
export type BugReportRequestBody = {
  category?: string;
  content: string;
  pageUrl?: string;
};

/**
 * Keep the subject and optional reply address instead of sending unsupported
 * JSON keys that the route would discard. The server still receives the
 * existing { category, content, pageUrl } contract and stores the complete
 * report in bug_reports.content.
 */
export function buildBugReportRequestBody(input: BugReportInput): BugReportRequestBody {
  const subject = input.subject.trim();
  const description = input.content.trim();
  const contactEmail = input.contactEmail?.trim();
  const sections = [
    'Subject: ' + subject,
    'Description:\n' + description,
  ];

  if (contactEmail) sections.push('Contact email: ' + contactEmail);

  return {
    category: input.category?.trim() || undefined,
    content: sections.join('\n\n'),
    pageUrl: input.pageUrl?.trim() || undefined,
  };
}

export async function submitBugReport(input: BugReportInput): Promise<{ id: string }> {
  const result = await request<{ id?: string }>('/api/bug-report', {
    method: 'POST',
    body: JSON.stringify(buildBugReportRequestBody(input)),
  });

  if (!result?.id) {
    throw new ApiError('伺服器未確認回報已建立');
  }

  return { id: result.id };
}
