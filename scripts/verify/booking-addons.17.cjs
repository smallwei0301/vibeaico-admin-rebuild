#!/usr/bin/env node
/* Issue #17 TEST verifier — runs the isolated integration suite. */
const { spawnSync } = require('node:child_process');
const required = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_SERVICE_ROLE_KEY', 'TEST_SUPABASE_ANON_KEY', 'INTEGRATION_BASE_URL', 'LINE_API_BASE'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Issue #17 verifier requires TEST credentials: ${missing.join(', ')}`);
if (!/^http:\/\/localhost:/.test(process.env.LINE_API_BASE)) throw new Error('Issue #17 verifier refuses non-local LINE provider');
const result = spawnSync('npm', ['run', 'test:integration', '--', 'tests/integration/api/booking-addons.17.test.ts'], {
  stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
