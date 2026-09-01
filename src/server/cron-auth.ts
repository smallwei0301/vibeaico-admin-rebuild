/** Validate a cron Bearer header without ever treating a missing secret as valid. */
export function isValidCronBearer(
  authorization: string | null,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret || cronSecret.trim() === '') return false;
  return authorization === `Bearer ${cronSecret}`;
}
