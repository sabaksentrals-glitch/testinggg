-- Recovered BIOFLOG relational schema.
--
-- FILENAME IS LOAD-BEARING. The migration runner keys `_migrations` by BASENAME
-- (scripts/migration-plan.mjs -> migrationName()), so this file MUST stay
-- `0002_bioflog.sql`: every database provisioned before the repo export already
-- recorded that exact name and must not re-run it. Renaming it (e.g. to
-- `0001_bioflog.sql`) would make existing databases treat it as a new migration.
--
-- Reconstructed read-only from the live schema via pg_catalog introspection.
-- Constraints are declared INLINE so each `create table if not exists` is a
-- single idempotent unit; tables are ordered so every FK target already exists.
-- `bioflog_state` is deliberately NOT here -- it is owned by
-- `0002_bioflog_state.sql`, which sorts first and therefore runs first.

create table if not exists farms (
  id varchar(64) primary key,
  name varchar(200) not null,
  timezone varchar(200) not null,
  address varchar(200) not null,
  version bigint not null
);

create table if not exists users (
  id varchar(64) primary key,
  email varchar(200) not null unique,
  name varchar(200) not null,
  password_hash varchar(200) not null,
  role varchar(200) not null,
  farm_id varchar(64) not null references farms(id),
  block varchar(200) not null,
  active bigint not null,
  finance bigint not null,
  device_control bigint not null,
  version bigint not null
);

create table if not exists ponds (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  code varchar(200) not null,
  name varchar(200) not null,
  block varchar(200) not null,
  shape varchar(200) not null,
  diameter_mm bigint not null,
  length_mm bigint not null,
  width_mm bigint not null,
  depth_mm bigint not null,
  capacity bigint not null,
  condition varchar(200) not null,
  version bigint not null,
  unique (farm_id, code)
);

create table if not exists cycles (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  pond_id varchar(64) not null references ponds(id),
  species varchar(200) not null,
  seed_batch varchar(200) not null,
  started_at varchar(200) not null,
  status varchar(200) not null,
  initial_count bigint not null,
  initial_abw_mg bigint not null,
  version bigint not null
);

create table if not exists records (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  cycle_id varchar(64) references cycles(id),
  kind varchar(200) not null,
  occurred_at varchar(200) not null,
  created_at varchar(200) not null,
  created_by varchar(64) not null references users(id),
  data json not null,
  status varchar(200) not null,
  version bigint not null,
  reversal_of varchar(200)
);

create table if not exists lots (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  name varchar(200) not null,
  supplier varchar(200) not null,
  document varchar(200) not null,
  received_at varchar(200) not null,
  expires_at varchar(200) not null,
  unit_cost bigint not null,
  version bigint not null
);

create table if not exists sales_orders (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  buyer varchar(200) not null,
  status varchar(200) not null,
  occurred_at varchar(200) not null,
  version bigint not null
);

create table if not exists harvest_lots (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  record_id varchar(64) not null references records(id),
  grade varchar(200) not null,
  grams bigint not null,
  unique (record_id, grade)
);

create table if not exists devices (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  pond_id varchar(64) not null references ponds(id),
  name varchar(200) not null,
  kind varchar(200) not null,
  token_hash varchar(200) not null,
  control_enabled bigint not null,
  last_seen varchar(200) not null,
  actual_state varchar(200) not null,
  state_measured_at varchar(200) not null,
  version bigint not null
);

create table if not exists device_commands (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  device_id varchar(64) not null references devices(id),
  target varchar(200) not null,
  status varchar(200) not null,
  issued_at varchar(200) not null,
  expires_at varchar(200) not null,
  reason varchar(200) not null,
  created_by varchar(64) not null references users(id),
  version bigint not null
);

create table if not exists command_receipts (
  id varchar(64) primary key,
  command_id varchar(64) not null references device_commands(id),
  stage varchar(200) not null,
  occurred_at varchar(200) not null,
  evidence json not null,
  unique (command_id, stage)
);

create table if not exists telemetry (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  device_id varchar(64) not null references devices(id),
  sequence varchar(200) not null,
  measured_at varchar(200) not null,
  received_at varchar(200) not null,
  data json not null,
  unique (device_id, sequence)
);

create table if not exists incidents (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  device_id varchar(64) not null references devices(id),
  kind varchar(200) not null,
  status varchar(200) not null,
  opened_at varchar(200) not null,
  closed_at varchar(200) not null,
  evidence_id varchar(200) not null
);

create table if not exists invoices (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  order_id varchar(64) not null unique references sales_orders(id),
  amount bigint not null,
  occurred_at varchar(200) not null,
  status varchar(200) not null
);

create table if not exists payments (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  invoice_id varchar(64) not null references invoices(id),
  amount bigint not null,
  occurred_at varchar(200) not null,
  reference varchar(200) not null,
  created_by varchar(64) not null references users(id)
);

create table if not exists allocations (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  order_id varchar(64) not null references sales_orders(id),
  lot_id varchar(64) not null references harvest_lots(id),
  grams bigint not null,
  price_per_kg bigint not null,
  unique (order_id, lot_id)
);

create table if not exists approvals (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  record_id varchar(64) not null references records(id),
  created_by varchar(64) not null references users(id),
  reason varchar(200) not null,
  payload json not null,
  payload_hash varchar(200) not null,
  status varchar(200) not null,
  version bigint not null,
  reviewer_id varchar(200),
  decision_reason varchar(200) not null
);

create table if not exists audit_events (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  actor_id varchar(64) not null references users(id),
  action varchar(200) not null,
  object_id varchar(200) not null,
  occurred_at varchar(200) not null,
  before json not null,
  after json not null,
  request_id varchar(200) not null
);

create table if not exists cycle_costs (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  cycle_id varchar(64) references cycles(id),
  record_id varchar(64) not null unique references records(id),
  amount bigint not null,
  category varchar(200) not null,
  occurred_at varchar(200) not null
);

create table if not exists population_events (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  cycle_id varchar(64) not null references cycles(id),
  record_id varchar(64) not null references records(id),
  count bigint not null,
  grams bigint not null,
  cohort varchar(200) not null,
  occurred_at varchar(200) not null,
  unique (record_id, cycle_id)
);

create table if not exists stock_movements (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  lot_id varchar(64) not null references lots(id),
  record_id varchar(64) not null references records(id),
  grams bigint not null,
  occurred_at varchar(200) not null,
  unique (record_id, lot_id)
);

create table if not exists tasks (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  pond_id varchar(64) references ponds(id),
  title varchar(200) not null,
  assignee_id varchar(64) not null references users(id),
  priority varchar(200) not null,
  due_at varchar(200) not null,
  status varchar(200) not null,
  checklist json not null,
  evidence varchar(200) not null,
  requires_verification bigint not null,
  version bigint not null,
  created_by varchar(64) not null references users(id),
  source_id varchar(200)
);

create table if not exists sop_versions (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  species varchar(200) not null,
  parameter varchar(200) not null,
  method varchar(200) not null,
  min_value varchar(200) not null,
  max_value varchar(200) not null,
  effective_at varchar(200) not null,
  stale_minutes bigint not null,
  version bigint not null,
  created_by varchar(64) not null references users(id)
);

create table if not exists locked_periods (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  through_date varchar(200) not null,
  created_by varchar(64) not null references users(id),
  created_at varchar(200) not null
);

create table if not exists idempotency (
  id varchar(64) primary key,
  user_id varchar(64) not null references users(id),
  key varchar(200) not null,
  payload_hash varchar(200) not null,
  response json not null,
  created_at varchar(200) not null,
  unique (user_id, key)
);

create table if not exists sessions (
  id varchar(64) primary key,
  user_id varchar(64) not null references users(id),
  csrf varchar(200) not null,
  expires_at varchar(200) not null
);

create table if not exists outbox (
  id varchar(64) primary key,
  farm_id varchar(64) not null references farms(id),
  topic varchar(200) not null,
  payload json not null,
  created_at varchar(200) not null,
  status varchar(200) not null,
  attempts bigint not null
);

create table if not exists login_attempts (
  id varchar(64) primary key,
  email varchar(200) not null,
  occurred_at varchar(200) not null,
  success bigint not null
);

create table if not exists schema_versions (
  version integer primary key,
  applied_at varchar(100) not null
);

-- Non-constraint indexes. `one_active_cycle` is the invariant that stops a pond
-- holding two active cycles at once.
create unique index if not exists one_active_cycle on cycles (pond_id) where status = 'active';
create index if not exists records_cycle_time on records (cycle_id, occurred_at);
