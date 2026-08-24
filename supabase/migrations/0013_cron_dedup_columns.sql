-- 0013 — Phase 7 cron 防重發欄位（07 分冊 §2 各 job 邏輯表）
--   booking-reminders：bookings.reminder_sent_at（同一預約只提醒一次）
--   customer-recall：customers.last_recall_at（30 天內不重推）

alter table bookings  add column if not exists reminder_sent_at timestamptz;
alter table customers add column if not exists last_recall_at   timestamptz;

-- booking-reminders 逐時掃描「即將開始且未提醒」的預約；部分索引把掃描面
-- 縮到未提醒的 CONFIRMED 預約。
create index if not exists idx_bookings_reminder_pending
  on bookings (tenant_id, start_at)
  where reminder_sent_at is null and status = 'CONFIRMED';
