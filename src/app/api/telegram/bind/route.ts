import { randomBytes } from 'node:crypto';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { hashBindCodeBytea } from '@/server/notifications/telegram-binding';

/**
 * Issues a one-time deep link for the currently signed-in tenant manager.
 * The code is returned once, while only its hash is stored by the binding
 * helper. Telegram's webhook consumes it atomically.
 */
export const POST = handle(async () => {
  const t = await requireTenant('MANAGER');
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '').trim();
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!username || !botToken || !webhookSecret)
    throw new ApiHttpError(409, 'Telegram 綁定尚未由平台啟用', ERR.CONFLICT);
  const code = randomBytes(24).toString('base64url');
  const { error } = await t.supabase.rpc('issue_tenant_telegram_bind_code', {
    p_tenant_id: t.tenantId,
    p_code_hash: hashBindCodeBytea(code),
  });
  if (error) throw error;
  return ok({ deepLink: `https://t.me/${username}?start=${code}`, expiresInMinutes: 15 });
});
