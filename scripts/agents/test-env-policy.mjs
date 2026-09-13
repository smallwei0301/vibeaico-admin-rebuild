import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Test identity must agree before reset, seed, or an application child starts.
// These are names only. Never print the values or silently replace a conflict.
export const TEST_ENV_IDENTITY_KEYS = Object.freeze([
  'SETTINGS_ENCRYPTION_KEY',
  'AUTH_SECRET',
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_ANON_KEY',
  'TEST_SUPABASE_SERVICE_ROLE_KEY',
  'TEST_CRON_SECRET',
  'CRON_SECRET',
]);

const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);

/**
 * Load a single snapshot of .env.test without changing inherited-value precedence.
 * If the file exists, conflicting test identities fail before ANY env mutation.
 * A missing file preserves the externally injected CI path; this does not certify
 * the external values or replace the independent TEST URL safety lock.
 * @param {import('node:fs').PathLike} envFile
 * @param {Record<string, string | undefined>} environment
 * @returns {boolean} Whether a file was loaded.
 */
export function loadCheckedTestEnv(envFile, environment = process.env) {
  let text;
  try {
    text = readFileSync(envFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error('[test-env] Cannot read .env.test; refusing to start test data operations.');
  }

  let parsed;
  try {
    parsed = parseEnv(text);
  } catch {
    throw new Error('[test-env] Cannot parse .env.test; refusing to start test data operations.');
  }

  const conflicts = TEST_ENV_IDENTITY_KEYS.filter((key) =>
    Object.hasOwn(parsed, key) && environment[key] !== undefined && environment[key] !== parsed[key]
  );
  if (conflicts.length) {
    const detail = conflicts.map((key) =>
      `${key} (environment sha256:${fingerprint(environment[key])}; .env.test sha256:${fingerprint(parsed[key])})`
    ).join(', ');
    throw new Error(`[test-env] TEST_ENV_CONFLICT: inherited environment overrides .env.test: ${detail}. Refusing to start reset/seed/server; fix the test environment first.`);
  }

  // Parse and load the SAME bytes: do not re-open a potentially changed file with
  // loadEnvFile after comparison. Unrelated inherited settings retain precedence.
  for (const [key, value] of Object.entries(parsed)) {
    if (environment[key] === undefined) environment[key] = value;
  }
  return true;
}
