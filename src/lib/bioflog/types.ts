export type Role = "Admin" | "Manajer" | "Operator" | "Pembaca";
export type Row = Record<string, any>;

export type Farm = {
  id: string;
  name: string;
  timezone: string;
  address: string;
  version: number;
};

export type User = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  farm_id: string;
  block: string;
  active: number;
  finance: number;
  device_control: number;
  version: number;
};

export type Pond = {
  id: string;
  farm_id: string;
  code: string;
  name: string;
  block: string;
  shape: string;
  diameter_mm: number;
  length_mm: number;
  width_mm: number;
  depth_mm: number;
  capacity: number;
  condition: string;
  version: number;
};

export type Cycle = {
  id: string;
  farm_id: string;
  pond_id: string;
  species: string;
  seed_batch: string;
  started_at: string;
  status: "active" | "closed";
  initial_count: number;
  initial_abw_mg: number;
  version: number;
};

export type RecordRow = {
  id: string;
  farm_id: string;
  cycle_id: string | null;
  kind: string;
  occurred_at: string;
  created_at: string;
  created_by: string;
  data: Row;
  status: string;
  version: number;
  reversal_of?: string | null;
};

export type PopMove = {
  id: string;
  farm_id: string;
  cycle_id: string;
  record_id: string;
  count: number;
  grams: number;
  cohort: string;
  occurred_at: string;
};

export type StockMove = {
  id: string;
  farm_id: string;
  lot_id: string;
  record_id: string;
  grams: number;
  occurred_at: string;
};

export type Lot = {
  id: string;
  farm_id: string;
  name: string;
  supplier: string;
  document: string;
  received_at: string;
  expires_at: string;
  unit_cost: number;
  version: number;
};

export type CostRow = {
  id: string;
  farm_id: string;
  cycle_id: string | null;
  record_id: string;
  amount: number;
  category: string;
  occurred_at: string;
};

export type Task = {
  id: string;
  farm_id: string;
  pond_id: string | null;
  title: string;
  assignee_id: string;
  priority: string;
  due_at: string;
  status: string;
  checklist: { label: string; done: boolean }[];
  evidence: string;
  requires_verification: number;
  version: number;
  created_by: string;
  source_id?: string | null;
};

export type Approval = {
  id: string;
  farm_id: string;
  record_id: string;
  created_by: string;
  reason: string;
  payload: Row;
  payload_hash: string;
  status: string;
  version: number;
  reviewer_id: string | null;
  decision_reason: string;
};

export type Device = {
  id: string;
  farm_id: string;
  pond_id: string;
  name: string;
  kind: string;
  token_hash: string;
  control_enabled: number;
  last_seen: string;
  actual_state: string;
  state_measured_at: string;
  version: number;
};

export type Command = {
  id: string;
  farm_id: string;
  device_id: string;
  target: string;
  status: string;
  issued_at: string;
  expires_at: string;
  reason: string;
  created_by: string;
  version: number;
};

export type HarvestLot = {
  id: string;
  farm_id: string;
  record_id: string;
  grade: string;
  grams: number;
};

export type Allocation = {
  id: string;
  farm_id: string;
  order_id: string;
  lot_id: string;
  grams: number;
  price_per_kg: number;
};

export type Order = {
  id: string;
  farm_id: string;
  buyer: string;
  status: string;
  occurred_at: string;
  version: number;
};

export type Invoice = {
  id: string;
  farm_id: string;
  order_id: string;
  amount: number;
  occurred_at: string;
  status: string;
};

export type Payment = {
  id: string;
  farm_id: string;
  invoice_id: string;
  amount: number;
  occurred_at: string;
  reference: string;
  created_by: string;
};

export type Period = {
  id: string;
  farm_id: string;
  through_date: string;
  created_by: string;
  created_at: string;
};

export type Sop = {
  id: string;
  farm_id: string;
  species: string;
  parameter: string;
  method: string;
  min_value: string;
  max_value: string;
  effective_at: string;
  stale_minutes: number;
  version: number;
  created_by: string;
};

export type AuditRow = {
  id: string;
  farm_id: string;
  actor_id: string;
  action: string;
  object_id: string;
  occurred_at: string;
  before: Row;
  after: Row;
  request_id: string;
};

export type Telemetry = {
  id: string;
  device_id: string;
  measured_at: string;
  received_at: string;
  data: Row;
};

export type Incident = {
  id: string;
  device_id: string;
  kind: string;
  status: string;
  opened_at: string;
};

export type Database = {
  farm: Farm;
  users: User[];
  ponds: Pond[];
  cycles: Cycle[];
  records: RecordRow[];
  population: PopMove[];
  stock: StockMove[];
  lots: Lot[];
  costs: CostRow[];
  tasks: Task[];
  approvals: Approval[];
  devices: Device[];
  commands: Command[];
  telemetry: Telemetry[];
  incidents: Incident[];
  harvestLots: HarvestLot[];
  allocations: Allocation[];
  orders: Order[];
  invoices: Invoice[];
  payments: Payment[];
  periods: Period[];
  sops: Sop[];
  audit: AuditRow[];
};

export const DEMO_PASSWORD = "BioflogDemo12";
export const DEMO_ACCOUNTS = [
  { email: "admin@bioflog.local", name: "Admin Farm", role: "Admin" as Role },
  { email: "manager@bioflog.local", name: "Manajer Farm", role: "Manajer" as Role },
  { email: "operator@bioflog.local", name: "Operator Blok A", role: "Operator" as Role },
  { email: "reader@bioflog.local", name: "Pembaca Farm", role: "Pembaca" as Role },
];
