-- OpenLaunch D1 Database Schema
-- JDD: 支援 Lead、Tenant、Config 三大核心實體
-- KISS: 簡化設計，預留擴展欄位

-- ===== Tenants（租戶） =====
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  email       TEXT,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','starter','pro','enterprise')),
  settings    TEXT DEFAULT '{}',  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now','utc')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','utc'))
);
CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ===== Leads（潛在客戶） =====
CREATE TABLE leads (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  company     TEXT,
  source      TEXT DEFAULT 'website' CHECK(source IN ('website','landing','api','webhook','manual')),
  status      TEXT DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','converted','lost')),
  tags        TEXT DEFAULT '[]',  -- JSON array
  metadata    TEXT DEFAULT '{}',  -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now','utc')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','utc'))
);
CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_status ON leads(status);

-- ===== Config（配置） =====
CREATE TABLE configs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  mcp_mode    TEXT NOT NULL DEFAULT 'sandbox' CHECK(mcp_mode IN ('sandbox','production')),
  channels    TEXT DEFAULT '[]',      -- JSON array of active channels
  branding    TEXT DEFAULT '{}',       -- JSON: logo, colors, domain
  integrations TEXT DEFAULT '{}',      -- JSON: notion, slack, github, crm
  rate_limit  INTEGER DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','utc')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','utc'))
);
CREATE INDEX idx_configs_tenant ON configs(tenant_id);

-- ===== Audit Log（審計日誌） =====
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  resource    TEXT,
  user_id     TEXT,
  ip          TEXT,
  user_agent  TEXT,
  metadata    TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','utc'))
);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at);
