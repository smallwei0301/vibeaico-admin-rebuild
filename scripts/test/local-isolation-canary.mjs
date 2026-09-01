#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

const CANARY_TENANT_ID = 'c1040000-0000-4000-8000-000000000001';
const CANARY_SHOP_CODE = 'issue-104-local-isolation-canary';
const MAX_BARRIER_LATENESS_MS = 5_000;
const DEFAULT_HOLD_MS = 30_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertLocalSupabaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`Local isolation canary refuses non-local Supabase host: ${url.hostname}`);
  }
  return url;
}

export function calculateBarrierWaitMs(barrierEpochSeconds, nowMs = Date.now()) {
  const barrier = Number(barrierEpochSeconds);
  if (!Number.isFinite(barrier) || barrier <= 0) {
    throw new Error('CANARY_BARRIER_EPOCH must be a positive Unix timestamp');
  }
  const waitMs = barrier * 1000 - nowMs;
  if (waitMs < -MAX_BARRIER_LATENESS_MS) {
    throw new Error(`Local isolation slot missed the shared barrier by ${Math.abs(waitMs)} ms`);
  }
  return Math.max(0, waitMs);
}

export async function runLocalIsolationCanary({
  supabaseUrl,
  serviceRoleKey,
  testEnvId,
  barrierEpochSeconds,
  holdMs = DEFAULT_HOLD_MS,
} = {}) {
  const url = assertLocalSupabaseUrl(supabaseUrl);
  if (!serviceRoleKey) throw new Error('TEST_SUPABASE_SERVICE_ROLE_KEY is required');
  if (!testEnvId) throw new Error('TEST_ENV_ID is required');

  const waitMs = calculateBarrierWaitMs(barrierEpochSeconds);
  if (waitMs > 0) {
    console.log(`[local-isolation-canary] waiting ${waitMs} ms for shared barrier`);
    await delay(waitMs);
  }

  const admin = createClient(url.toString(), serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const marker = `Issue #104 ${testEnvId}`;
  let inserted = false;

  try {
    const { error: insertError } = await admin.from('tenants').insert({
      id: CANARY_TENANT_ID,
      shop_code: CANARY_SHOP_CODE,
      name: marker,
    });
    if (insertError) {
      throw new Error(`fixed-id insert failed; local TEST slots may share one database: ${insertError.message}`);
    }
    inserted = true;

    const { data: firstRead, error: firstReadError } = await admin
      .from('tenants')
      .select('id,shop_code,name')
      .eq('id', CANARY_TENANT_ID)
      .single();
    if (firstReadError) throw new Error(`canary read failed: ${firstReadError.message}`);
    if (firstRead?.name !== marker || firstRead?.shop_code !== CANARY_SHOP_CODE) {
      throw new Error('canary row does not belong to this TEST_ENV_ID');
    }

    // Both matrix jobs intentionally use the same primary key after one shared barrier.
    // If they were connected to one database, one insert would conflict immediately.
    await delay(holdMs);

    const { data: secondRead, error: secondReadError } = await admin
      .from('tenants')
      .select('name')
      .eq('id', CANARY_TENANT_ID)
      .single();
    if (secondReadError) throw new Error(`canary hold read failed: ${secondReadError.message}`);
    if (secondRead?.name !== marker) {
      throw new Error('canary row changed while another local slot was running');
    }

    return {
      testEnvId,
      host: url.hostname,
      fixedTenantId: CANARY_TENANT_ID,
      barrierEpochSeconds: Number(barrierEpochSeconds),
      verified: true,
    };
  } finally {
    if (inserted) {
      const { error: deleteError } = await admin
        .from('tenants')
        .delete()
        .eq('id', CANARY_TENANT_ID)
        .eq('name', marker);
      if (deleteError) throw new Error(`canary cleanup failed: ${deleteError.message}`);
    }
  }
}

async function cli() {
  const result = await runLocalIsolationCanary({
    supabaseUrl: process.env.TEST_SUPABASE_URL,
    serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    testEnvId: process.env.TEST_ENV_ID,
    barrierEpochSeconds: process.env.CANARY_BARRIER_EPOCH,
  });
  console.log(`[local-isolation-canary] ${JSON.stringify(result)}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  cli().catch((error) => {
    console.error(`[local-isolation-canary] ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
