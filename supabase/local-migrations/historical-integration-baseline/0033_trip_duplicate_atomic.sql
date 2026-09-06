-- 0033_trip_duplicate_atomic.sql — issue #8 follow-up: one atomic duplicate RPC.
--
-- The HTTP route previously performed eight serial Data API requests.  Keep
-- authorization and RLS at the database boundary, while one SECURITY INVOKER
-- function locks the source trip, picks a deterministic copy slug, and writes
-- the trip, its plans, and its addons in one statement transaction.

create or replace function public.duplicate_trip_atomic(
  p_tenant_id uuid,
  p_source_trip_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source public.trips%rowtype;
  v_copy public.trips%rowtype;
  v_base_slug text;
  v_copy_slug text;
  v_suffix integer := 2;
  v_plan_count integer;
  v_min_price numeric;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id
       and tu.user_id = auth.uid()
       and tu.role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'manager role required for this tenant' using errcode = '42501';
  end if;

  -- This source-row lock serializes duplicate calls for the same source trip.
  -- RLS remains active because this function is SECURITY INVOKER; an absent or
  -- cross-tenant source therefore returns NULL for the HTTP layer to map to 404.
  select t.*
    into v_source
    from public.trips t
   where t.tenant_id = p_tenant_id
     and t.id = p_source_trip_id
   for update;
  if not found then
    return null;
  end if;

  v_base_slug := v_source.slug || '-copy';
  v_copy_slug := v_base_slug;
  loop
    exit when not exists (
      select 1
        from public.trips t
       where t.tenant_id = p_tenant_id
         and t.slug = v_copy_slug
    );
    v_copy_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  insert into public.trips (
    tenant_id, slug, title, tagline, summary, description, region, category,
    cover_image_url, gallery, duration_minutes, meeting_point, meeting_point_map_url,
    inclusions, exclusions, notices, refund_rules, safety_notice, good_for, faq,
    social_proof_quotes, refund_policy_type, status, midao_listing, midao_listing_note
  ) values (
    p_tenant_id, v_copy_slug, v_source.title || '（複本）', v_source.tagline,
    v_source.summary, v_source.description, v_source.region, v_source.category,
    v_source.cover_image_url, v_source.gallery, v_source.duration_minutes,
    v_source.meeting_point, v_source.meeting_point_map_url, v_source.inclusions,
    v_source.exclusions, v_source.notices, v_source.refund_rules, v_source.safety_notice,
    v_source.good_for, v_source.faq, v_source.social_proof_quotes,
    v_source.refund_policy_type, 'DRAFT', 'NONE', ''
  )
  returning * into v_copy;

  insert into public.trip_plans (
    tenant_id, trip_id, slug, name, description, duration_minutes, price_type,
    base_price, child_price, min_participants, max_participants, booking_type,
    deposit_mode, deposit_value, active, year_round, seasons, review_state, review_note,
    sort_order, highlights, plan_inclusions, plan_exclusions, plan_notices,
    plan_refund_rules, plan_itinerary, meeting_point_name, meeting_address,
    experience_point_name, experience_address, language, earliest_departure,
    confirm_by_days, free_cancel_days, details_link_text, booking_btn_text
  )
  select
    p_tenant_id, v_copy.id, p.slug, p.name, p.description, p.duration_minutes,
    p.price_type, p.base_price, p.child_price, p.min_participants, p.max_participants,
    p.booking_type, p.deposit_mode, p.deposit_value, p.active, p.year_round, p.seasons,
    'NONE', '', p.sort_order, p.highlights, p.plan_inclusions, p.plan_exclusions,
    p.plan_notices, p.plan_refund_rules, p.plan_itinerary, p.meeting_point_name,
    p.meeting_address, p.experience_point_name, p.experience_address, p.language,
    p.earliest_departure, p.confirm_by_days, p.free_cancel_days, p.details_link_text,
    p.booking_btn_text
    from public.trip_plans p
   where p.tenant_id = p_tenant_id
     and p.trip_id = v_source.id;

  insert into public.trip_addons (
    tenant_id, trip_id, name, price, unit, stock, active, sort_order
  )
  select
    p_tenant_id, v_copy.id, a.name, a.price, a.unit, a.stock, a.active, a.sort_order
    from public.trip_addons a
   where a.tenant_id = p_tenant_id
     and a.trip_id = v_source.id;

  select
    count(*)::integer,
    coalesce(min(p.base_price) filter (where p.active), 0)
    into v_plan_count, v_min_price
    from public.trip_plans p
   where p.tenant_id = p_tenant_id
     and p.trip_id = v_copy.id;

  return jsonb_build_object(
    'trip', to_jsonb(v_copy),
    'plan_count', v_plan_count,
    'min_price', v_min_price,
    'upcoming_departure_count', 0
  );
end;
$$;

revoke all on function public.duplicate_trip_atomic(uuid, uuid) from public;
revoke all on function public.duplicate_trip_atomic(uuid, uuid) from anon;
revoke all on function public.duplicate_trip_atomic(uuid, uuid) from service_role;
grant execute on function public.duplicate_trip_atomic(uuid, uuid) to authenticated;
