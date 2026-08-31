-- 0051 — Owner 2026-08-31: Midao's default refund basis is only actual,
-- evidenced non-refundable cost. It is not a fixed percentage schedule.
alter table public.trip_plans alter column cancellation_policy set default jsonb_build_object(
  'source', 'MIDAO_TEMPLATE',
  'refundBasis', 'ACTUAL_NONREFUNDABLE_COST',
  'bands', jsonb_build_array(
    jsonb_build_object('minimumDaysBeforeDeparture', 8),
    jsonb_build_object('minimumDaysBeforeDeparture', 4),
    jsonb_build_object('minimumDaysBeforeDeparture', 0)
  )
);

-- Only enrich Midao-template snapshots that predate the Owner basis decision;
-- custom policies and their historical snapshots are never rewritten.
update public.trip_plans
set cancellation_policy = jsonb_set(cancellation_policy, '{refundBasis}', '"ACTUAL_NONREFUNDABLE_COST"'::jsonb)
where cancellation_policy->>'source' = 'MIDAO_TEMPLATE'
  and not (cancellation_policy ? 'refundBasis');
update public.tour_orders
set cancellation_policy_snapshot = jsonb_set(cancellation_policy_snapshot, '{refundBasis}', '"ACTUAL_NONREFUNDABLE_COST"'::jsonb)
where cancellation_policy_snapshot->>'source' = 'MIDAO_TEMPLATE'
  and not (cancellation_policy_snapshot ? 'refundBasis');
