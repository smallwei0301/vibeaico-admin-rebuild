import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { hashBindCodeBytea, isValidBindCode, verifyTelegramWebhookSecret } from '@/server/notifications/telegram-binding';

export const runtime = 'nodejs';

type TelegramUpdate = {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number } };
};

/**
 * The platform Bot uses this one endpoint. It accepts only `/start <code>`
 * binding updates; sendMessage happens through the outbox dispatcher, never
 * inline in webhook processing. Invalid secrets are rejected; malformed but
 * authentic updates return 200 so Telegram does not endlessly redeliver them.
 */
export async function POST(req: Request) {
  if (!verifyTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET,
    req.headers.get('x-telegram-bot-api-secret-token')))
    return new Response('unauthorized', { status: 401 });
  let update: TelegramUpdate;
  try {
    update = await req.json() as TelegramUpdate;
  } catch {
    // An authentic malformed update has no bind code to retry; acknowledge it
    // so Telegram does not redeliver it indefinitely.
    return NextResponse.json({ accepted: true, bound: false });
  }
  try {
    const text = update.message?.text?.trim() ?? '';
    const code = text.startsWith('/start ') ? text.slice('/start '.length).trim() : '';
    const chatId = update.message?.chat?.id;
    const updateId = update.update_id;
    if (!Number.isSafeInteger(updateId) || !Number.isSafeInteger(chatId) || !isValidBindCode(code))
      return NextResponse.json({ accepted: true, bound: false });
    const { data: bound, error } = await createAdminSupabase().rpc('consume_telegram_bind_code', {
      p_bot_id: process.env.TELEGRAM_BOT_ID ?? 'platform', p_update_id: updateId,
      p_code_hash: hashBindCodeBytea(code), p_chat_id: chatId,
    });
    if (error) throw error;
    return NextResponse.json({ accepted: true, bound: Boolean(bound) });
  } catch (error) {
    console.error('[telegram-webhook] processing failed', error instanceof Error ? error.message : 'unknown');
    // Telegram retries 5xx responses. Returning 200 here would permanently
    // lose a valid one-time bind code after a transient DB/RPC failure.
    return new Response('telegram webhook processing failed', { status: 500 });
  }
}
