create table if not exists bioflog_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
