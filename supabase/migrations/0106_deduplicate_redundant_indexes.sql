-- #413: remove only the four explicitly audited, non-unique duplicate indexes.
--
-- This is intentionally a guarded migration rather than a collection of
-- unconditional DROP INDEX statements.  A missing counterpart means that
-- there is no proven duplicate to remove, so the index is preserved.  A
-- changed definition, dependency, constraint, or lock conflict aborts the
-- whole migration.
--
-- The migration runner must execute this file in one transaction.  The table
-- locks are deliberately short-lived and NOWAIT is used so a busy table fails
-- closed instead of waiting behind application traffic.

SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $deduplicate$
DECLARE
  pair record;
  old_oid oid;
  keep_oid oid;
  table_oid oid;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('trip_addons', 'trip_addons_trip_idx', 'trip_addons_tenant_trip_sort_idx', '(tenant_id, trip_id, sort_order)'),
      ('tour_orders', 'tour_orders_tenant_status_idx', 'i_tour_orders', '(tenant_id, status, created_at DESC)'),
      ('tour_orders', 'tour_orders_traveler_idx', 'i_tour_orders_traveler', '(traveler_user_id) WHERE (traveler_user_id IS NOT NULL)'),
      ('tenant_payment_methods', 'i_tenant_payment_methods_order', 'tenant_payment_methods_tenant_sort', '(tenant_id, sort_order, created_at)')
    ) AS allowlist(table_name, old_name, keep_name, expected_keys)
    ORDER BY table_name, old_name
  LOOP
    old_oid := to_regclass(format('public.%I', pair.old_name));
    keep_oid := to_regclass(format('public.%I', pair.keep_name));

    -- Do not remove a sole index or recreate a missing counterpart merely to
    -- make the names look symmetrical.
    IF old_oid IS NULL OR keep_oid IS NULL THEN
      RAISE NOTICE 'PRESERVED_OR_ABSENT: % / %', pair.old_name, pair.keep_name;
      CONTINUE;
    END IF;

    table_oid := to_regclass(format('public.%I', pair.table_name));
    IF table_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE oid = table_oid
        AND relkind = 'r'
        AND NOT relispartition
    ) THEN
      RAISE EXCEPTION 'INDEX_DEDUP_UNEXPECTED_TABLE: %', pair.table_name;
    END IF;

    EXECUTE format(
      'LOCK TABLE ONLY public.%I IN ACCESS EXCLUSIVE MODE NOWAIT',
      pair.table_name
    );

    -- Re-read the names after the lock.  This prevents a concurrent DDL
    -- change from turning the allowlist into a name-only deletion.
    IF old_oid IS DISTINCT FROM to_regclass(format('public.%I', pair.old_name))
       OR keep_oid IS DISTINCT FROM to_regclass(format('public.%I', pair.keep_name)) THEN
      RAISE EXCEPTION 'INDEX_DEDUP_CATALOG_CHANGED: %', pair.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_index old_i
      JOIN pg_class old_c ON old_c.oid = old_i.indexrelid
      JOIN pg_index keep_i ON keep_i.indexrelid = keep_oid
      JOIN pg_class keep_c ON keep_c.oid = keep_i.indexrelid
      WHERE old_i.indexrelid = old_oid
        AND old_i.indrelid = table_oid
        AND keep_i.indrelid = table_oid
        AND old_c.relkind = 'i'
        AND keep_c.relkind = 'i'
        AND NOT old_c.relispartition
        AND NOT keep_c.relispartition
        AND old_c.relam = keep_c.relam
        AND old_c.relowner = keep_c.relowner
        AND old_c.reltablespace = keep_c.reltablespace
        AND old_c.relpersistence = keep_c.relpersistence
        AND old_c.reloptions IS NOT DISTINCT FROM keep_c.reloptions
        AND old_i.indisvalid
        AND keep_i.indisvalid
        AND old_i.indisready
        AND keep_i.indisready
        AND old_i.indislive
        AND keep_i.indislive
        AND NOT old_i.indcheckxmin
        AND NOT keep_i.indcheckxmin
        AND NOT old_i.indisunique
        AND NOT keep_i.indisunique
        AND NOT old_i.indisprimary
        AND NOT keep_i.indisprimary
        AND NOT old_i.indisexclusion
        AND NOT keep_i.indisexclusion
        AND NOT old_i.indisclustered
        AND NOT keep_i.indisclustered
        AND NOT old_i.indisreplident
        AND NOT keep_i.indisreplident
        AND old_i.indkey = keep_i.indkey
        AND old_i.indclass = keep_i.indclass
        AND old_i.indcollation = keep_i.indcollation
        AND old_i.indoption = keep_i.indoption
        AND old_i.indnkeyatts = keep_i.indnkeyatts
        AND old_i.indnatts = keep_i.indnatts
        AND old_i.indnullsnotdistinct = keep_i.indnullsnotdistinct
        AND old_i.indexprs::text IS NOT DISTINCT FROM keep_i.indexprs::text
        AND old_i.indpred::text IS NOT DISTINCT FROM keep_i.indpred::text
        AND pg_get_indexdef(old_oid) = format(
          'CREATE INDEX %I ON public.%I USING btree %s',
          pair.old_name,
          pair.table_name,
          pair.expected_keys
        )
        AND pg_get_indexdef(keep_oid) = format(
          'CREATE INDEX %I ON public.%I USING btree %s',
          pair.keep_name,
          pair.table_name,
          pair.expected_keys
        )
    ) THEN
      RAISE EXCEPTION 'INDEX_DEDUP_NOT_EQUIVALENT_OR_SAFE: % / %', pair.old_name, pair.keep_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conindid IN (old_oid, keep_oid)
    )
       OR EXISTS (
         SELECT 1
         FROM pg_inherits
         WHERE inhrelid IN (old_oid, keep_oid)
            OR inhparent IN (old_oid, keep_oid)
       )
       OR EXISTS (
         SELECT 1
         FROM pg_depend
         WHERE refclassid = 'pg_catalog.pg_class'::regclass
           AND refobjid = old_oid
       )
       OR EXISTS (
         SELECT 1
         FROM pg_depend
         WHERE classid = 'pg_catalog.pg_class'::regclass
           AND objid = old_oid
           AND deptype IN ('e', 'i', 'P', 'S')
       ) THEN
      RAISE EXCEPTION 'INDEX_DEDUP_DEPENDENCY: %', pair.old_name;
    END IF;

    EXECUTE format('DROP INDEX public.%I RESTRICT', pair.old_name);

    IF to_regclass(format('public.%I', pair.old_name)) IS NOT NULL
       OR keep_oid IS DISTINCT FROM to_regclass(format('public.%I', pair.keep_name))
       OR NOT EXISTS (
         SELECT 1
         FROM pg_index
         WHERE indexrelid = keep_oid
           AND indisvalid
           AND indisready
           AND indislive
       ) THEN
      RAISE EXCEPTION 'INDEX_DEDUP_POSTCONDITION: %', pair.table_name;
    END IF;

    RAISE NOTICE 'DEDUPLICATED: removed %, retained %', pair.old_name, pair.keep_name;
  END LOOP;
END $deduplicate$;

-- Rollback reference (run each statement separately, outside a transaction,
-- only after checking that the named index is absent and the retained index
-- is still present):
-- CREATE INDEX CONCURRENTLY trip_addons_trip_idx
--   ON public.trip_addons USING btree (tenant_id, trip_id, sort_order);
-- CREATE INDEX CONCURRENTLY tour_orders_tenant_status_idx
--   ON public.tour_orders USING btree (tenant_id, status, created_at DESC);
-- CREATE INDEX CONCURRENTLY tour_orders_traveler_idx
--   ON public.tour_orders USING btree (traveler_user_id)
--   WHERE (traveler_user_id IS NOT NULL);
-- CREATE INDEX CONCURRENTLY i_tenant_payment_methods_order
--   ON public.tenant_payment_methods USING btree (tenant_id, sort_order, created_at);
