import { Resend } from 'resend';
import { classifyTransportFailure, type TransportOutcome } from './delivery';

export interface EmailTransportInput {
  apiKey: string | undefined;
  from: string;
  to: string;
  subject: string;
  html: string;
}

export type EmailSender = (input: Omit<EmailTransportInput, 'apiKey'>) => Promise<{
  data: { id?: string | null } | null;
  error: { name?: string | null; message?: string | null; statusCode?: number | null } | null;
}>;

/**
 * Adapter seam for Resend. A successful `/emails` response is only provider
 * acceptance; delivery webhooks are the sole code path that may mark DELIVERED.
 */
export async function sendEmailTransport(input: EmailTransportInput, sender: EmailSender): Promise<TransportOutcome> {
  if (!input.apiKey) return { kind: 'skipped', code: 'NOT_CONFIGURED' };
  try {
    const { data, error } = await sender({ from: input.from, to: input.to, subject: input.subject, html: input.html });
    if (data?.id) return { kind: 'accepted', providerMessageId: data.id };
    return classifyTransportFailure('EMAIL', error?.statusCode ?? undefined, error?.message ?? error?.name ?? 'Resend rejected request');
  } catch {
    return { kind: 'retryable', code: 'TRANSPORT_ERROR' };
  }
}

export async function sendEmailWithResend(input: EmailTransportInput): Promise<TransportOutcome> {
  const apiKey = input.apiKey;
  return sendEmailTransport(input, async ({ from, to, subject, html }) => {
    const result = await new Resend(apiKey!).emails.send({ from, to, subject, html });
    return { data: result.data ? { id: result.data.id } : null, error: result.error };
  });
}

export interface TelegramTransportInput {
  token: string | undefined;
  chatId: string;
  text: string;
}

export type TelegramFetch = typeof fetch;

/** Telegram 200 means accepted by Telegram; it must never be rendered as read. */
export async function sendTelegramTransport(
  input: TelegramTransportInput,
  fetcher: TelegramFetch = fetch,
): Promise<TransportOutcome> {
  if (!input.token || !input.chatId) return { kind: 'skipped', code: 'NOT_CONFIGURED' };
  try {
    const response = await fetcher(`https://api.telegram.org/bot${input.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: input.chatId, text: input.text, disable_web_page_preview: true }),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean; description?: string; result?: { message_id?: number };
    };
    if (response.ok && body.ok && body.result?.message_id !== undefined)
      return { kind: 'accepted', providerMessageId: String(body.result.message_id) };
    return classifyTransportFailure('TELEGRAM', response.status, body.description ?? 'Telegram rejected request');
  } catch {
    return { kind: 'retryable', code: 'TRANSPORT_ERROR' };
  }
}
