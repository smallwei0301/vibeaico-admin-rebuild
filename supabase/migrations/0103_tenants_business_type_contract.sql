-- #298: canonical source for tenants.business_type.
--
-- Historical local-only migration 0015 introduced this runtime field, but it is
-- not part of the canonical migration ledger. Both observed environments already
-- use this text contract. Keep text (rather than an enum) so future business
-- types can be introduced through a checked migration without enum lifecycle
-- constraints. This migration deliberately does not repair data, alter RLS/ACLs,
-- or wire registration.

DO $business_type$
DECLARE
  v_tenants oid := to_regclass('public.tenants');
  v_type text;
  v_not_null boolean;
  v_default text;
  v_has_equivalent boolean := false;
  v_constraint record;
  v_normalized_definition text;
BEGIN
  IF v_tenants IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_TYPE_MISSING_TENANTS_TABLE';
  END IF;

  -- Keep the timeout, advisory lock, table lock, preflight, and DDL in this
  -- one DO statement so psql autocommit cannot split the reconciliation.
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(hashtext('vibeaico:0103:tenants:business_type'));
  LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;

  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = v_tenants
     AND a.attname = 'business_type'
     AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE public.tenants
      ADD COLUMN business_type text NOT NULL DEFAULT 'LOCAL_SHOP'::text;
  ELSIF v_type <> 'text' OR NOT v_not_null
     OR v_default IS DISTINCT FROM '''LOCAL_SHOP''::text' THEN
    RAISE EXCEPTION 'BUSINESS_TYPE_COLUMN_SHAPE: type=% not_null=% default=%',
      coalesce(v_type, '<missing>'), coalesce(v_not_null::text, '<missing>'),
      coalesce(v_default, '<missing>');
  END IF;

  -- Adding NOT NULL/default above is only safe for a missing column. Existing
  -- rows must already be one of the three runtime values; do not coerce them.
  IF EXISTS (
    SELECT 1
      FROM public.tenants
     WHERE business_type IS NULL
        OR business_type <> ALL (ARRAY['LOCAL_SHOP'::text, 'GUIDE'::text, 'CLINIC'::text])
  ) THEN
    RAISE EXCEPTION 'BUSINESS_TYPE_INVALID_DATA' USING ERRCODE = '23514';
  END IF;

  FOR v_constraint IN
    SELECT c.oid, c.conname, c.convalidated, pg_get_constraintdef(c.oid, false) AS definition
      FROM pg_constraint c
     WHERE c.conrelid = v_tenants
       AND c.contype = 'c'
  LOOP
    v_normalized_definition := regexp_replace(v_constraint.definition, '\s+', '', 'g');

    IF v_normalized_definition =
       'CHECK((business_type=ANY(ARRAY[''LOCAL_SHOP''::text,''GUIDE''::text,''CLINIC''::text])))'
       AND v_constraint.convalidated THEN
      v_has_equivalent := true;
    ELSIF v_constraint.conname = 'tenants_business_type_check' THEN
      RAISE EXCEPTION 'BUSINESS_TYPE_CHECK_NAME_COLLISION: %', v_constraint.definition;
    ELSIF v_normalized_definition ILIKE '%business_type%' THEN
      RAISE EXCEPTION 'BUSINESS_TYPE_UNKNOWN_CHECK_SHAPE: %', v_constraint.definition;
    END IF;
  END LOOP;

  IF NOT v_has_equivalent THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_business_type_check
      CHECK (business_type = ANY (ARRAY['LOCAL_SHOP'::text, 'GUIDE'::text, 'CLINIC'::text])) NOT VALID;
    ALTER TABLE public.tenants
      VALIDATE CONSTRAINT tenants_business_type_check;
  END IF;
END
$business_type$;
