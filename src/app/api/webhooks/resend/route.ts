import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';
import { hashRecipientEmail, mapResendDeliveryEvent, recipientHealthKeyRequired, verifyResendWebhook } from '@/server/notifications/resend-webhook';

export const runtime = 'nodejs';

type ResendEvent = {
  type?: string;
  data?: { email_id?: string; email?: { id?: string }; to?: string[] };
};

export async function POST(req: Request) {
  const body = await req.text();
  const webhookId = req.headers.get('svix-id');
  if (!verifyResendWebhook(body, {
    id: webhookId,
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  }, process.env.RESEND_WEBHOOK_SECRET)) return new Response('unauthorized', { status: 401 });

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const evidence = mapResendDeliveryEvent(event.type ?? '');
  if (!evidence) return NextResponse.json({ accepted: true, applied: false });
  const providerMessageId = event.data?.email_id ?? event.data?.email?.id;
  if (!providerMessageId || !webhookId) return new Response('bad request', { status: 400 });
  const recipient = event.data?.to?.[0]?.trim().toLowerCase();
  const recipientHealthKey = process.env.RESEND_RECIPIENT_HEALTH_KEY;
  if (recipientHealthKeyRequired(evidence, recipient, recipientHealthKey)) {
    console.error('[resend-webhook] RESEND_RECIPIENT_HEALTH_KEY is required to record a bounced recipient');
    return new Response('recipient health key not configured', { status: 503 });
  }
  const recipientHash = evidence.unhealthy && recipient
    ? hashRecipientEmail(recipient, recipientHealthKey!) : null;
  const { data, error } = await createAdminSupabase().rpc('apply_resend_delivery_event', {
    p_webhook_event_id: webhookId,
    p_provider_message_id: providerMessageId,
    p_status: evidence.status,
    p_error_code: evidence.errorCode,
    p_recipient_hash: recipientHash,
  });
  if (error) {
    console.error('[resend-webhook] apply failed', error.message);
    return new Response('webhook apply failed', { status: 500 });
  }
  if (data === 'NOT_FOUND') return new Response('delivery not ready', { status: 503 });
  return NextResponse.json({ accepted: true, applied: data === 'APPLIED' });
}
