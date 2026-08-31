import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';

export const runtime = 'nodejs';

/** Move expired, under-minimum departures into REVIEW_REQUIRED. The SQL RPC
 * owns row locking, event creation, and idempotency; this cron owns no state. */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const { data, error } = await createAdminSupabase().rpc('review_expired_tour_formations', {
    p_now: new Date().toISOString(),
  });
  if (error) {
    console.error('[cron] tour-formation-review failed', error);
    return new Response('review failed', { status: 500 });
  }
  return NextResponse.json({ reviewed: data ?? 0 });
}
