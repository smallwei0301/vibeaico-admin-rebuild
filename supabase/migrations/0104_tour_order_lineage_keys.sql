-- #396：把 tour_orders 的血統約束從「四條單欄 FK」升級成 canonical TEST 已有的複合鏈。
-- 產品契約：docs/integration/10-TOUR-DOMAIN.md §1.1 / §1.3。
--
-- ## 現況（2026-09-13 實查兩座 Supabase）
--
-- canonical TEST（nmwhwngojosmagjuvxol）的 tour_orders 已經有完整四層血統鏈：
--
--   (tenant_id, customer_id)                    -> customers(tenant_id, id)          set null (customer_id)
--   (tenant_id, trip_id)                        -> trips(tenant_id, id)              restrict
--   (tenant_id, trip_id, plan_id)               -> trip_plans(tenant_id, trip_id, id) restrict
--   (tenant_id, trip_id, plan_id, departure_id) -> trip_departures(tenant_id, trip_id, plan_id, id) restrict
--
-- 帳本（0087）與正式庫（egehnijjpgijmccagxac）都只有單欄 FK：
--
--   trip_id -> trips(id) / plan_id -> trip_plans(id) / departure_id -> trip_departures(id)
--   customer_id -> customers(id)
--
-- 單欄 FK 擋不住跨租戶血統：RLS 是 is_tenant_member(tenant_id)，只看 tenant_id 一欄，
-- 所以 A 店成員可以直接寫入 tenant_id = A 但 trip/plan/departure 指向 B 店的一列，
-- 四條 FK 全部通過。走 create_tour_order RPC 不會發生（0087 的 RPC 從 departure 反推
-- trip/plan，且 departure 先以 tenant_id = p_tenant 篩過），但直接表寫入沒人擋。
--
-- 方向刻意是「把帳本與正式庫拉到 TEST 的強度」，不是把 TEST 降到帳本——與 #298
-- 的 0102_assignment_tenant_parent_keys 同一個原則：對齊不得弱化任何一邊。
--
-- ## 這一檔不做的事
--
-- 不改任何一列資料、不動 RLS、不動角色／PUBLIC 權限、不改 delete 語意、
-- 不重寫任何歷史 migration。若既有資料已經有跨租戶血統的列，本檔**中止**，
-- 不「修正」那些列——資料歸屬是 Owner 的判斷，不是 migration 的。
--
-- 正式庫需另行具名授權後才套用。
--
-- 整包放在一個 DO 裡，即使在沒有外層交易的 CLI 下也是全有全無。

DO $lineage$
DECLARE
  spec        record;
  fk          record;
  child_oid   oid := to_regclass('public.tour_orders');
  parent_oid  oid;
  fk_count    integer;
  rls_before  boolean;
  force_rls_before boolean;
  child_cols  text[];
BEGIN
  IF child_oid IS NULL THEN
    RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_MISSING_TABLE: tour_orders';
  END IF;

  SELECT relrowsecurity, relforcerowsecurity INTO rls_before, force_rls_before
    FROM pg_class WHERE oid = child_oid;

  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.tour_orders, public.trips, public.trip_plans,
             public.trip_departures, public.customers
    IN SHARE ROW EXCLUSIVE MODE;

  -- ------------------------------------------------------------------ 先查資料
  -- 絕不以刪除或改派租戶來「修好」不一致的列。
  IF EXISTS (
    SELECT 1 FROM public.tour_orders o
     LEFT JOIN public.trips t            ON t.id = o.trip_id
     LEFT JOIN public.trip_plans p       ON p.id = o.plan_id
     LEFT JOIN public.trip_departures d  ON d.id = o.departure_id
     LEFT JOIN public.customers c        ON c.id = o.customer_id
     WHERE t.id IS NULL OR p.id IS NULL OR d.id IS NULL
        OR t.tenant_id IS DISTINCT FROM o.tenant_id
        OR p.tenant_id IS DISTINCT FROM o.tenant_id
        OR d.tenant_id IS DISTINCT FROM o.tenant_id
        OR p.trip_id   IS DISTINCT FROM o.trip_id
        OR d.trip_id   IS DISTINCT FROM o.trip_id
        OR d.plan_id   IS DISTINCT FROM o.plan_id
        OR (o.customer_id IS NOT NULL
            AND (c.id IS NULL OR c.tenant_id IS DISTINCT FROM o.tenant_id))
  ) THEN
    RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_DATA_MISMATCH' USING ERRCODE = '23514';
  END IF;

  -- -------------------------------------------------------------- 補父表唯一鍵
  -- 正式庫已有 trips/trip_plans/trip_departures 的三支鍵，缺的只有 customers。
  -- 名稱刻意與 TEST 一致，且不用 IF NOT EXISTS——撞名應該炸，不該被吞掉。
  FOR spec IN SELECT * FROM (VALUES
      ('trips',            'trips_tenant_id_id_key',                  ARRAY['tenant_id','id']),
      ('trip_plans',       'trip_plans_tenant_trip_id_id_key',        ARRAY['tenant_id','trip_id','id']),
      ('trip_departures',  'trip_departures_tenant_trip_plan_id_id_key', ARRAY['tenant_id','trip_id','plan_id','id']),
      ('customers',        'customers_tenant_id_id_key',              ARRAY['tenant_id','id'])
    ) AS e(parent_table, key_name, key_cols)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);
    IF parent_oid IS NULL THEN
      RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_MISSING_TABLE: %', spec.parent_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
       WHERE con.conrelid = parent_oid AND con.contype IN ('p','u') AND NOT con.condeferrable
         AND (SELECT array_agg(a.attname::text ORDER BY k.n)
                FROM unnest(con.conkey) WITH ORDINALITY k(num, n)
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num)
             = spec.key_cols
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)',
        spec.parent_table, spec.key_name,
        (SELECT string_agg(quote_ident(c), ', ') FROM unnest(spec.key_cols) AS c));
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------ 換 FK
  FOR spec IN SELECT * FROM (VALUES
      ('trips',           'tour_orders_tenant_trip_fkey',
       ARRAY['tenant_id','trip_id'],                        ARRAY['tenant_id','id'],
       'RESTRICT', 'r', ''),
      ('trip_plans',      'tour_orders_tenant_trip_plan_fkey',
       ARRAY['tenant_id','trip_id','plan_id'],              ARRAY['tenant_id','trip_id','id'],
       'RESTRICT', 'r', ''),
      ('trip_departures', 'tour_orders_tenant_trip_plan_departure_fkey',
       ARRAY['tenant_id','trip_id','plan_id','departure_id'],
       ARRAY['tenant_id','trip_id','plan_id','id'],         'RESTRICT', 'r', ''),
      ('customers',       'tour_orders_tenant_customer_fkey',
       ARRAY['tenant_id','customer_id'],                    ARRAY['tenant_id','id'],
       'SET NULL (customer_id)', 'n', 'customer_id')
    ) AS e(parent_table, fk_name, child_cols, parent_cols, delete_action, deltype, null_col)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);

    SELECT count(*) INTO fk_count FROM pg_constraint
     WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;
    IF fk_count <> 1 THEN
      RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_AMBIGUOUS_FK: % (found %)', spec.parent_table, fk_count;
    END IF;
    SELECT * INTO STRICT fk FROM pg_constraint
     WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;

    SELECT array_agg(a.attname::text ORDER BY k.n) INTO child_cols
      FROM unnest(fk.conkey) WITH ORDINALITY k(num, n)
      JOIN pg_attribute a ON a.attrelid = child_oid AND a.attnum = k.num;

    -- 已經是目標形狀（canonical TEST）：只補驗證，保留原名，不重建。
    IF child_cols = spec.child_cols THEN
      IF NOT fk.convalidated THEN
        EXECUTE format('ALTER TABLE public.tour_orders VALIDATE CONSTRAINT %I', fk.conname);
      END IF;
      CONTINUE;
    END IF;

    -- 只接受已知的弱形狀：單欄 FK、非 deferred、delete 語意與目標一致。
    IF fk.condeferrable OR fk.condeferred OR fk.confupdtype <> 'a' OR fk.confmatchtype <> 's'
       OR fk.confdeltype::text <> spec.deltype
       OR child_cols <> ARRAY[spec.child_cols[array_length(spec.child_cols, 1)]] THEN
      RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_UNEXPECTED_FK: % (%)', spec.parent_table, fk.conname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = child_oid AND conname = spec.fk_name) THEN
      RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_FK_NAME_COLLISION: %', spec.fk_name;
    END IF;

    -- 先建強鍵並驗證，再拆弱鍵。兩支同時存在會讓 PostgREST 的關聯變成歧義，
    -- 所以不能留著；但也不能先拆再建，那會出現一段沒有任何約束的空窗。
    EXECUTE format(
      'ALTER TABLE public.tour_orders ADD CONSTRAINT %I FOREIGN KEY (%s) '
      'REFERENCES public.%I (%s) ON DELETE %s NOT VALID',
      spec.fk_name,
      (SELECT string_agg(quote_ident(c), ', ') FROM unnest(spec.child_cols) AS c),
      spec.parent_table,
      (SELECT string_agg(quote_ident(c), ', ') FROM unnest(spec.parent_cols) AS c),
      spec.delete_action);
    EXECUTE format('ALTER TABLE public.tour_orders VALIDATE CONSTRAINT %I', spec.fk_name);
    EXECUTE format('ALTER TABLE public.tour_orders DROP CONSTRAINT %I', fk.conname);
  END LOOP;

  -- -------------------------------------------------------------- 後置條件
  -- 獨立重查一次最終形狀，不信任上面的流程。
  FOR spec IN SELECT * FROM (VALUES
      ('trips',           ARRAY['tenant_id','trip_id'],                          ARRAY['tenant_id','id'],                       'r'),
      ('trip_plans',      ARRAY['tenant_id','trip_id','plan_id'],                ARRAY['tenant_id','trip_id','id'],             'r'),
      ('trip_departures', ARRAY['tenant_id','trip_id','plan_id','departure_id'], ARRAY['tenant_id','trip_id','plan_id','id'],   'r'),
      ('customers',       ARRAY['tenant_id','customer_id'],                      ARRAY['tenant_id','id'],                       'n')
    ) AS e(parent_table, child_cols, parent_cols, deltype)
  LOOP
    parent_oid := to_regclass('public.' || spec.parent_table);
    SELECT count(*) INTO fk_count FROM pg_constraint
     WHERE conrelid = child_oid AND contype = 'f' AND confrelid = parent_oid;
    IF fk_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM pg_constraint con
       WHERE con.conrelid = child_oid AND con.contype = 'f' AND con.confrelid = parent_oid
         AND con.convalidated AND NOT con.condeferrable AND NOT con.condeferred
         AND con.confupdtype = 'a' AND con.confmatchtype = 's'
         AND con.confdeltype::text = spec.deltype
         AND (SELECT array_agg(a.attname::text ORDER BY k.n)
                FROM unnest(con.conkey) WITH ORDINALITY k(num, n)
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num)
             = spec.child_cols
         AND (SELECT array_agg(a.attname::text ORDER BY k.n)
                FROM unnest(con.confkey) WITH ORDINALITY k(num, n)
                JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num)
             = spec.parent_cols
    ) THEN
      RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_POSTCONDITION: %', spec.parent_table;
    END IF;
  END LOOP;

  -- 反向：tenant_id -> tenants 那條必須原封不動，且不得多出任何 FK。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class pc ON pc.oid = con.confrelid
     WHERE con.conrelid = child_oid AND con.contype = 'f' AND pc.relname = 'tenants'
       AND con.confdeltype::text = 'c'
  ) THEN
    RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_TENANT_FK_CHANGED';
  END IF;
  SELECT count(*) INTO fk_count FROM pg_constraint WHERE conrelid = child_oid AND contype = 'f';
  IF fk_count <> 5 THEN
    RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_FK_COUNT: expected 5, found %', fk_count;
  END IF;

  -- 反向：RLS 開關不得被本檔改動。
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = child_oid
      AND relrowsecurity = rls_before AND relforcerowsecurity = force_rls_before) THEN
    RAISE EXCEPTION 'TOUR_ORDER_LINEAGE_RLS_CHANGED';
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
END
$lineage$;
