-- #298: align fresh/main and TEST assignment integrity without weakening TEST.
-- Product contract: docs/integration/10-TOUR-DOMAIN.md sections 1.3 / 5.4.
-- Both the departure and staff must belong to the assignment's tenant.
-- No row repair, no PUBLIC/role/RLS change, no historical migration rewrite.
-- Apply to Production only after a separately named authorization.
-- One DO statement makes the entire upgrade atomic even outside a CLI transaction.
DO $reconcile$
DECLARE
  spec record;
  fk record;
  parent_oid oid;
  child_oid oid := to_regclass('public.trip_departure_staff');
  child_tenant smallint;
  child_parent smallint;
  parent_tenant smallint;
  parent_id smallint;
  fk_count integer;
  rls_before boolean;
  force_rls_before boolean;
BEGIN
  IF child_oid IS NULL OR to_regclass('public.staff') IS NULL
      OR to_regclass('public.trip_departures') IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_MISSING_TABLE';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- Stop concurrent parent/child writes before checking data or replacing keys.
  LOCK TABLE public.staff, public.trip_departures, public.trip_departure_staff
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT relrowsecurity, relforcerowsecurity INTO rls_before, force_rls_before
    FROM pg_class WHERE oid = child_oid;

  -- Never "repair" a mismatched tenant by deleting or reassigning its rows.
  IF EXISTS (
    SELECT 1 FROM public.trip_departure_staff a
    LEFT JOIN public.trip_departures d ON d.id = a.departure_id
    LEFT JOIN public.staff s ON s.id = a.staff_id
    WHERE d.id IS NULL OR s.id IS NULL OR a.tenant_id IS DISTINCT FROM d.tenant_id
       OR a.tenant_id IS DISTINCT FROM s.tenant_id
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_DATA_MISMATCH' USING ERRCODE = '23514';
  END IF;

  SELECT attnum INTO child_tenant FROM pg_attribute
    WHERE attrelid = child_oid AND attname = 'tenant_id' AND NOT attisdropped;

  -- Preflight BOTH parents before any DDL. Same-name/different-definition,
  -- duplicate relationships, deferred keys, or different delete behavior stop.
  FOR spec IN SELECT * FROM (VALUES
      ('staff', 'staff_id', 'r'),
      ('trip_departures', 'departure_id', 'c')
    ) AS e(parent_table, child_column, delete_action)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);
    SELECT attnum INTO child_parent FROM pg_attribute
      WHERE attrelid = child_oid AND attname = spec.child_column AND NOT attisdropped;
    SELECT attnum INTO parent_tenant FROM pg_attribute
      WHERE attrelid = parent_oid AND attname = 'tenant_id' AND NOT attisdropped;
    SELECT attnum INTO parent_id FROM pg_attribute
      WHERE attrelid = parent_oid AND attname = 'id' AND NOT attisdropped;
    IF child_tenant IS NULL OR child_parent IS NULL OR parent_tenant IS NULL OR parent_id IS NULL THEN
      RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_MISSING_COLUMN: %', spec.parent_table;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute
      WHERE (attrelid = child_oid AND attnum IN (child_tenant, child_parent)
          OR attrelid = parent_oid AND attnum IN (parent_tenant, parent_id))
        AND (atttypid <> 'uuid'::regtype OR NOT attnotnull)) THEN
      RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_COLUMN_SHAPE: %', spec.parent_table;
    END IF;
    SELECT count(*) INTO fk_count FROM pg_constraint
      WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;
    IF fk_count <> 1 THEN
      RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_AMBIGUOUS: %', spec.parent_table;
    END IF;
    SELECT * INTO STRICT fk FROM pg_constraint
      WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;
    IF fk.confdeltype::text <> spec.delete_action OR fk.confupdtype <> 'a'
        OR fk.confmatchtype <> 's' OR fk.condeferrable OR fk.condeferred
        OR NOT (
          (fk.conkey = ARRAY[child_parent]::smallint[] AND fk.confkey = ARRAY[parent_id]::smallint[])
          OR (fk.conkey = ARRAY[child_tenant, child_parent]::smallint[]
            AND fk.confkey = ARRAY[parent_tenant, parent_id]::smallint[])
        ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_UNEXPECTED_FK: %', spec.parent_table;
    END IF;
    IF fk.conkey = ARRAY[child_parent]::smallint[] THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = child_oid
          AND conname = 'trip_departure_staff_tenant_id_' || spec.child_column || '_fkey') THEN
        RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_FK_NAME_COLLISION: %', spec.parent_table;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = parent_oid
          AND contype IN ('p', 'u') AND NOT condeferrable
          AND conkey = ARRAY[parent_tenant, parent_id]::smallint[])
          AND to_regclass('public.' || spec.parent_table || '_tenant_id_id_key') IS NOT NULL THEN
        RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_PARENT_KEY_COLLISION: %', spec.parent_table;
      END IF;
    END IF;
  END LOOP;

  FOR spec IN SELECT * FROM (VALUES
      ('staff', 'staff_id', 'RESTRICT'),
      ('trip_departures', 'departure_id', 'CASCADE')
    ) AS e(parent_table, child_column, delete_action)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);
    SELECT attnum INTO child_parent FROM pg_attribute
      WHERE attrelid = child_oid AND attname = spec.child_column AND NOT attisdropped;
    SELECT attnum INTO parent_tenant FROM pg_attribute
      WHERE attrelid = parent_oid AND attname = 'tenant_id' AND NOT attisdropped;
    SELECT attnum INTO parent_id FROM pg_attribute
      WHERE attrelid = parent_oid AND attname = 'id' AND NOT attisdropped;
    SELECT * INTO STRICT fk FROM pg_constraint
      WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;

    IF fk.conkey = ARRAY[child_tenant, child_parent]::smallint[] THEN
      -- The existing TEST composite key is already stronger: preserve its name.
      IF NOT fk.convalidated THEN
        EXECUTE format('ALTER TABLE public.trip_departure_staff VALIDATE CONSTRAINT %I', fk.conname);
      END IF;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = parent_oid AND contype IN ('p', 'u') AND NOT condeferrable
        AND conkey = ARRAY[parent_tenant, parent_id]::smallint[]) THEN
      -- A name collision intentionally raises; IF NOT EXISTS would hide bad shape.
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)',
        spec.parent_table, spec.parent_table || '_tenant_id_id_key');
    END IF;

    -- Validate the stronger key BEFORE removing the known weaker key.
    -- Keeping both after commit would make PostgREST staff(name) ambiguous.
    EXECUTE format('ALTER TABLE public.trip_departure_staff ADD CONSTRAINT %I '
      'FOREIGN KEY (tenant_id, %I) REFERENCES public.%I (tenant_id, id) ON DELETE %s NOT VALID',
      'trip_departure_staff_tenant_id_' || spec.child_column || '_fkey',
      spec.child_column, spec.parent_table, spec.delete_action);
    EXECUTE format('ALTER TABLE public.trip_departure_staff VALIDATE CONSTRAINT %I',
      'trip_departure_staff_tenant_id_' || spec.child_column || '_fkey');
    EXECUTE format('ALTER TABLE public.trip_departure_staff DROP CONSTRAINT %I', fk.conname);
  END LOOP;

  -- Assert the final shape independently: exactly one non-deferred, validated
  -- tenant-parent relationship per parent, with the original delete semantics.
  FOR spec IN SELECT * FROM (VALUES
      ('staff', 'staff_id', 'r'), ('trip_departures', 'departure_id', 'c')
    ) AS e(parent_table, child_column, delete_action)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);
    SELECT count(*) INTO fk_count FROM pg_constraint c
      WHERE c.conrelid = child_oid AND c.contype = 'f' AND c.confrelid = parent_oid;
    IF fk_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = child_oid AND c.contype = 'f' AND c.confrelid = parent_oid
        AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
        AND c.confdeltype::text = spec.delete_action AND c.confupdtype = 'a' AND c.confmatchtype = 's'
        AND (SELECT array_agg(a.attname::text ORDER BY k.n)
          FROM unnest(c.conkey) WITH ORDINALITY k(num,n)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num)
          = ARRAY['tenant_id', spec.child_column]
        AND (SELECT array_agg(a.attname::text ORDER BY k.n)
          FROM unnest(c.confkey) WITH ORDINALITY k(num,n)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num)
          = ARRAY['tenant_id', 'id']
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_POSTCONDITION: %', spec.parent_table;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = child_oid
      AND relrowsecurity = rls_before AND relforcerowsecurity = force_rls_before) THEN
    RAISE EXCEPTION 'ASSIGNMENT_PARENT_KEYS_RLS_CHANGED';
  END IF;
  PERFORM pg_notify('pgrst', 'reload schema');
END
$reconcile$;
