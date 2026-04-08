create extension if not exists pgcrypto;

create table if not exists availability_levels (
  key text primary key,
  label text not null,
  weight numeric(4,2) not null check (weight >= 0),
  sort_order integer not null default 0
);

create table if not exists time_slot_presets (
  key text primary key,
  label text not null,
  starts_at time,
  ends_at time,
  sort_order integer not null default 0
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  default_result_mode text not null default 'strict_all' check (default_result_mode in ('strict_all', 'maximize_attendance')),
  created_at timestamptz not null default now()
);

create table if not exists event_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  date date not null,
  time_slot_key text not null references time_slot_presets(key),
  selection_mode text not null default 'range' check (selection_mode in ('range', 'discrete')),
  date_type text not null default 'single' check (date_type in ('single', 'range')),
  start_date date not null default current_date,
  end_date date not null default current_date,
  selected_dates date[] not null default '{}',
  time_type text not null default 'fixed' check (time_type in ('fixed', 'all_day', 'unspecified')),
  start_time time,
  end_time time,
  note text,
  sort_order integer not null default 0
);

alter table event_candidates
  add column if not exists selection_mode text not null default 'range';

alter table event_candidates
  add column if not exists date_type text not null default 'single';

alter table event_candidates
  add column if not exists start_date date;

alter table event_candidates
  add column if not exists end_date date;

alter table event_candidates
  add column if not exists selected_dates date[] not null default '{}';

alter table event_candidates
  add column if not exists time_type text not null default 'fixed';

alter table event_candidates
  add column if not exists start_time time;

alter table event_candidates
  add column if not exists end_time time;

alter table event_candidates
  drop constraint if exists event_candidates_event_id_date_time_slot_key_key;

update event_candidates
set
  start_date = coalesce(start_date, date),
  end_date = coalesce(end_date, date),
  selection_mode = case
    when coalesce(array_length(selected_dates, 1), 0) > 0 then 'discrete'
    else coalesce(selection_mode, 'range')
  end,
  date_type = case
    when coalesce(start_date, date) <> coalesce(end_date, date) then 'range'
    else coalesce(date_type, 'single')
  end,
  time_type = case
    when time_slot_key = 'all_day' then 'all_day'
    when time_slot_key = 'unspecified' then 'unspecified'
    else coalesce(time_type, 'fixed')
  end,
  start_time = case
    when start_time is not null then start_time
    when time_slot_key = 'day' then time '12:00'
    when time_slot_key = 'night' then time '18:00'
    else start_time
  end,
  end_time = case
    when end_time is not null then end_time
    when time_slot_key = 'day' then time '17:00'
    when time_slot_key = 'night' then time '22:00'
    else end_time
  end;

create table if not exists participant_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  participant_name text not null,
  note text,
  submitted_at timestamptz not null default now(),
  unique (event_id, participant_name)
);

create table if not exists participant_candidate_answers (
  id uuid primary key default gen_random_uuid(),
  participant_response_id uuid not null references participant_responses(id) on delete cascade,
  candidate_id uuid not null references event_candidates(id) on delete cascade,
  availability_key text not null references availability_levels(key),
  selected_dates date[] not null default '{}',
  preferred_time_slot_key text references time_slot_presets(key),
  date_time_preferences jsonb not null default '{}'::jsonb,
  available_start_time time,
  available_end_time time,
  updated_at timestamptz not null default now(),
  unique (participant_response_id, candidate_id)
);

alter table participant_candidate_answers
  add column if not exists selected_dates date[] not null default '{}';

alter table participant_candidate_answers
  add column if not exists preferred_time_slot_key text references time_slot_presets(key);

alter table participant_candidate_answers
  add column if not exists date_time_preferences jsonb not null default '{}'::jsonb;

alter table participant_candidate_answers
  add column if not exists available_start_time time;

alter table participant_candidate_answers
  add column if not exists available_end_time time;
