import { fail, handle } from '@/server/http';

/** #9 owns credential lookup and provider signature verification. This route
 * accepts no payment payload until that verified callback exists. */
export const POST = handle(async () =>
  fail(503, 'PAYMENT_PROVIDER_BLOCKED_BY_DEPENDENCY_9', 'PAYMENT_PROVIDER_BLOCKED_BY_DEPENDENCY_9'));
