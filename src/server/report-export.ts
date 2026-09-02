import { z } from 'zod';

export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const REPORT_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const dateSchema = z.string()
  .regex(DATE_RE, '日期需為 YYYY-MM-DD')
  .refine(isCalendarDate, '日期不是有效的日曆日期');

export const reportExportQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
}).superRefine((query, ctx) => {
  if ((query.from && !query.to) || (!query.from && query.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '日期區間需同時提供 from 與 to' });
  }
});

export function taipeiDayMs(ymd: string, offsetDays = 0): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return Date.UTC(year, month - 1, day + offsetDays) - TAIPEI_OFFSET_MS;
}

export function taipeiLabel(ms: number): string {
  const date = new Date(ms + TAIPEI_OFFSET_MS);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function taipeiDate(ms: number): string {
  const date = new Date(ms + TAIPEI_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Escape CSV delimiters and neutralize spreadsheet formulas without corrupting
 * numeric values such as negative revenue.  Report numbers are emitted as
 * numbers by the caller; only user-controlled strings receive the apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const source = String(value);
  const isFormula = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(source);
  const safe = isFormula ? `'${source}` : source;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}
