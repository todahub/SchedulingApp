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
  note text,
  sort_order integer not null default 0,
  unique (event_id, date, time_slot_key)
);

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
  updated_at timestamptz not null default now(),
  unique (participant_response_id, candidate_id)
);
