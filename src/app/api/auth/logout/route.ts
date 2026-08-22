import { handle, ok } from '@/server/http';
import { createServerSupabase } from '@/server/supabase';

export const POST = handle(async () => {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return ok({ loggedOut: true });
});
