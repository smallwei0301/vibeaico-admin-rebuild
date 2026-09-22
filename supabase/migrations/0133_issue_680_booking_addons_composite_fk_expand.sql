-- #680: expand booking_addons performance_staff FK to a transitional, tenant-safe BOTH shape.
-- Canonical main 0121 created only performance_staff_id -> staff(id); canonical TEST
-- independently had only the stronger (tenant_id, performance_staff_id) -> staff(tenant_id, id).
-- This forward migration does not choose one environment over the other.  It preserves/adds
-- both exact, validated relationships so the current runtime hint remains usable while a later
-- activation slice switches PostgREST to the composite relationship.
--
-- No row repair: orphaned or cross-tenant existing values fail closed.  Unknown FK shapes,
-- same-name collisions, deferred/unvalidated constraints, or changed delete semantics also fail.
-- This migration is source preparation only.  It does not apply TEST or Production schema.

DO $booking_addons_perf_fk_expand$
DECLARE
  child_oid oid := to_regclass('public.booking_addons');
  staff_oid oid := to_regclass('public.staff');
  child_tenant smallint;
  child_perf smallint;
  staff_tenant smallint;
  staff_id smallint;
  fk record;
  rls_before boolean;
  force_rls_before boolean;
  perf_fk_count integer;
BEGIN
  IF child_oid IS NULL OR staff_oid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_MISSING_TABLE';
  END IF;

  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.staff, public.booking_addons IN SHARE ROW EXCLUSIVE MODE;

  SELECT relrowsecurity, relforcerowsecurity INTO rls_before, force_rls_before
    FROM pg_class WHERE oid = child_oid;

  SELECT attnum INTO child_tenant FROM pg_attribute
   WHERE attrelid = child_oid AND attname = 'tenant_id' AND NOT attisdropped;
  SELECT attnum INTO child_perf FROM pg_attribute
   WHERE attrelid = child_oid AND attname = 'performance_staff_id' AND NOT attisdropped;
  SELECT attnum INTO staff_tenant FROM pg_attribute
   WHERE attrelid = staff_oid AND attname = 'tenant_id' AND NOT attisdropped;
  SELECT attnum INTO staff_id FROM pg_attribute
   WHERE attrelid = staff_oid AND attname = 'id' AND NOT attisdropped;
  IF child_tenant IS NULL OR child_perf IS NULL OR staff_tenant IS NULL OR staff_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_MISSING_COLUMN';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE (a.attrelid = child_oid AND a.attnum IN (child_tenant, child_perf))
        OR (a.attrelid = staff_oid AND a.attnum IN (staff_tenant, staff_id))
      AND (a.atttypid <> 'uuid'::regtype OR (a.attnum IN (child_tenant, staff_tenant, staff_id) AND NOT a.attnotnull))
  ) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_COLUMN_SHAPE';
  END IF;

  -- The composite FK needs a validated, immediate parent key.  A same-name relation
  -- with a different shape is deliberately not hidden by IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = staff_oid
       AND c.contype IN ('p', 'u')
       AND c.convalidated
       AND NOT c.condeferrable
       AND NOT c.condeferred
       AND c.conkey = ARRAY[staff_tenant, staff_id]::smallint[]
  ) THEN
    IF to_regclass('public.staff_tenant_id_id_key') IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_PARENT_KEY_COLLISION';
    END IF;
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  -- Do not use the new FK as a data cleaner.  This must be checked before DDL.
  IF EXISTS (
    SELECT 1
      FROM public.booking_addons a
      LEFT JOIN public.staff s ON s.id = a.performance_staff_id
     WHERE a.performance_staff_id IS NOT NULL
       AND (s.id IS NULL OR s.tenant_id IS DISTINCT FROM a.tenant_id)
  ) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_TENANT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  -- There may be exactly the two named performance relationships.  Any third
  -- relationship using performance_staff_id is ambiguous to PostgREST and unsafe to preserve.
  FOR fk IN
    SELECT c.*
      FROM pg_constraint c
     WHERE c.conrelid = child_oid
       AND c.contype = 'f'
       AND child_perf = ANY (c.conkey)
  LOOP
    IF fk.conname NOT IN (
      'booking_addons_performance_staff_id_fkey',
      'booking_addons_tenant_id_performance_staff_id_fkey'
    ) THEN
      RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_UNKNOWN_FK: %', fk.conname;
    END IF;

    IF fk.conname = 'booking_addons_performance_staff_id_fkey' AND NOT (
      fk.confrelid = staff_oid
      AND fk.conkey = ARRAY[child_perf]::smallint[]
      AND fk.confkey = ARRAY[staff_id]::smallint[]
      AND fk.confupdtype = 'a'
      AND fk.confdeltype = 'n'
      AND fk.confmatchtype = 's'
      AND fk.convalidated
      AND NOT fk.condeferrable
      AND NOT fk.condeferred
      AND fk.confdelsetcols IS NULL
    ) THEN
      RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_SINGLE_FK_SHAPE: %', fk.conname;
    END IF;

    IF fk.conname = 'booking_addons_tenant_id_performance_staff_id_fkey' AND NOT (
      fk.confrelid = staff_oid
      AND fk.conkey = ARRAY[child_tenant, child_perf]::smallint[]
      AND fk.confkey = ARRAY[staff_tenant, staff_id]::smallint[]
      AND fk.confupdtype = 'a'
      AND fk.confdeltype = 'n'
      AND fk.confmatchtype = 's'
      AND fk.convalidated
      AND NOT fk.condeferrable
      AND NOT fk.condeferred
      AND fk.confdelsetcols = ARRAY[child_perf]::smallint[]
    ) THEN
      RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_COMPOSITE_FK_SHAPE: %', fk.conname;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = child_oid
       AND c.conname = 'booking_addons_tenant_id_performance_staff_id_fkey'
  ) THEN
    ALTER TABLE public.booking_addons
      ADD CONSTRAINT booking_addons_tenant_id_performance_staff_id_fkey
      FOREIGN KEY (tenant_id, performance_staff_id)
      REFERENCES public.staff (tenant_id, id)
      ON DELETE SET NULL (performance_staff_id)
      NOT VALID;
    ALTER TABLE public.booking_addons
      VALIDATE CONSTRAINT booking_addons_tenant_id_performance_staff_id_fkey;
  END IF;

  -- Retain/add the 0121 identity temporarily: current runtime explicitly embeds it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = child_oid
       AND c.conname = 'booking_addons_performance_staff_id_fkey'
  ) THEN
    ALTER TABLE public.booking_addons
      ADD CONSTRAINT booking_addons_performance_staff_id_fkey
      FOREIGN KEY (performance_staff_id)
      REFERENCES public.staff (id)
      ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE public.booking_addons
      VALIDATE CONSTRAINT booking_addons_performance_staff_id_fkey;
  END IF;

  -- Independent final catalog readback; do not trust the branch above.
  SELECT count(*) INTO perf_fk_count
    FROM pg_constraint c
   WHERE c.conrelid = child_oid
     AND c.contype = 'f'
     AND child_perf = ANY (c.conkey);
  IF perf_fk_count <> 2
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = child_oid
          AND c.conname = 'booking_addons_performance_staff_id_fkey'
          AND c.confrelid = staff_oid
          AND c.conkey = ARRAY[child_perf]::smallint[]
          AND c.confkey = ARRAY[staff_id]::smallint[]
          AND c.confupdtype = 'a' AND c.confdeltype = 'n' AND c.confmatchtype = 's'
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND c.confdelsetcols IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = child_oid
          AND c.conname = 'booking_addons_tenant_id_performance_staff_id_fkey'
          AND c.confrelid = staff_oid
          AND c.conkey = ARRAY[child_tenant, child_perf]::smallint[]
          AND c.confkey = ARRAY[staff_tenant, staff_id]::smallint[]
          AND c.confupdtype = 'a' AND c.confdeltype = 'n' AND c.confmatchtype = 's'
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND c.confdelsetcols = ARRAY[child_perf]::smallint[]
     ) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_POSTCONDITION';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = child_oid
       AND relrowsecurity = rls_before
       AND relforcerowsecurity = force_rls_before
  ) THEN
    RAISE EXCEPTION 'BOOKING_ADDONS_PERFORMANCE_STAFF_RLS_CHANGED';
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
END
$booking_addons_perf_fk_expand$;
