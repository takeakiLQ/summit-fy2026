-- Cloudflare D1 初期スキーマ
-- 各テーブルは現在のFirestoreコレクションに対応

-- チームマスタ
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_teams_active ON teams(active);

-- メンバーマスタ
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team) REFERENCES teams(id)
);
CREATE INDEX IF NOT EXISTS idx_members_active ON members(active);
CREATE INDEX IF NOT EXISTS idx_members_team ON members(team);
CREATE INDEX IF NOT EXISTS idx_members_role ON members(role);

-- 案件（Salesforceから同期）
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  name TEXT,
  manual_no TEXT,
  owner_name TEXT,
  owner_email TEXT,
  owner_name_raw TEXT,
  owner_email_raw TEXT,
  matched_by TEXT,
  team_id TEXT,
  ms_kbn_raw TEXT,
  ms_kbn TEXT,
  monthly_revenue REAL,
  contract_price REAL,
  monthly_workdays REAL,
  daily_hours REAL,
  status TEXT,
  classification TEXT,
  operation_start_date TEXT,
  planned_start_date TEXT,
  registered_at TEXT,
  last_modified_at TEXT,
  hourly_rate REAL,
  hourly_coef REAL,
  hourly_coef_label TEXT,
  base_point REAL,
  point REAL,
  has_issue INTEGER DEFAULT 0,
  issues TEXT,           -- JSON配列
  year_month TEXT,
  fiscal_year TEXT,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deals_year_month ON deals(year_month);
CREATE INDEX IF NOT EXISTS idx_deals_fiscal_year ON deals(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_deals_owner_email ON deals(owner_email);
CREATE INDEX IF NOT EXISTS idx_deals_owner_name ON deals(owner_name);
CREATE INDEX IF NOT EXISTS idx_deals_team ON deals(team_id);

-- 月別実績（CSV取込）
CREATE TABLE IF NOT EXISTS monthly_revenue (
  id TEXT PRIMARY KEY,       -- yearMonth_dealId
  year_month TEXT NOT NULL,
  fiscal_year TEXT,
  deal_id TEXT NOT NULL,
  manual_no TEXT,
  owner_name TEXT,
  team_id TEXT,
  revenue REAL DEFAULT 0,
  gross_profit REAL DEFAULT 0,
  workdays REAL DEFAULT 0,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  uploaded_by TEXT,
  source_file TEXT
);
CREATE INDEX IF NOT EXISTS idx_monthly_year_month ON monthly_revenue(year_month);
CREATE INDEX IF NOT EXISTS idx_monthly_deal ON monthly_revenue(deal_id);
CREATE INDEX IF NOT EXISTS idx_monthly_owner ON monthly_revenue(owner_name);
CREATE INDEX IF NOT EXISTS idx_monthly_team ON monthly_revenue(team_id);

-- 設定（KPI閾値、係数など）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,        -- JSON
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- メタ（同期状態など）
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,        -- JSON
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 集計サマリー（事前計算済み）
CREATE TABLE IF NOT EXISTS summary (
  key TEXT PRIMARY KEY,       -- 'aggregate'
  value TEXT NOT NULL,        -- JSON（aggregate, aggregateByPeriod, aggregateByFiscalYear, financials...）
  computed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 監査ログ
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  action TEXT,
  target TEXT,
  detail TEXT,                -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
