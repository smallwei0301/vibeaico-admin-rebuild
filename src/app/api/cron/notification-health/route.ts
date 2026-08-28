import { NextResponse } from 'next/server';
import { dispatchPendingNotifications } from '@/server/notifications/outbox';
import { createDailyHealthReport } from '@/server/notifications/health-report';

export const runtime = 'nodejs';

/** Daily 09:00 Asia/Taipei report (00:00 UTC). Vercel Hobby may delay it. */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`)
    return new Response('unauthorized', { status: 401 });
  try {
    const digest = await createDailyHealthReport();
    const dispatched = await dispatchPendingNotifications();
    return NextResponse.json({ created: true, dispatched, periodEnd: digest.periodEnd });
  } catch (error) {
    console.error('[cron] notification-health failed', error instanceof Error ? error.message : 'unknown');
    return new Response('notification health failed', { status: 500 });
  }
}
