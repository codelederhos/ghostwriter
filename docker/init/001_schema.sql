-- Ghostwriter Schema v1
-- Multi-Tenant autonomes SEO-Content-System

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Auth
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) DEFAULT 'admin',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- Multi-Tenant Core
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  domain VARCHAR(255),
  logo_url VARCHAR(500),
  plan VARCHAR(50) DEFAULT 'free',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Tenant Settings (API Keys, Providers, Scheduling)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Text Model
  text_provider VARCHAR(50) DEFAULT 'anthropic',
  text_api_key TEXT,
  text_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  text_custom_endpoint VARCHAR(500),
  -- Image Model
  image_provider VARCHAR(50) DEFAULT 'dalle3',
  image_api_key TEXT,
  image_style_prefix TEXT DEFAULT 'Fotorealistisch, professionell, keine KI-Gesichter, modernes Business-Ambiente',
  -- GBP
  gbp_oauth_token TEXT,
  gbp_refresh_token TEXT,
  gbp_account_id VARCHAR(255),
  gbp_location_id VARCHAR(255),
  -- Reporting
  telegram_bot_token VARCHAR(255),
  telegram_chat_id VARCHAR(255),
  report_email VARCHAR(255),
  -- Scheduling
  frequency_hours INT DEFAULT 72,
  next_run_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Tenant Profile (Company info for AI prompts)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  company_name VARCHAR(255),
  industry VARCHAR(100),
  region VARCHAR(255),
  usp TEXT,
  positioning TEXT,
  services TEXT,
  brand_voice VARCHAR(255) DEFAULT 'professionell, nahbar, selbstbewusst',
  languages TEXT[] DEFAULT ARRAY['de'],
  target_audience TEXT,
  website_url VARCHAR(500),
  cta_url VARCHAR(500),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Tenant Topics (Content categories)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category_id INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  description TEXT,
  default_cta VARCHAR(50) DEFAULT 'LEARN_MORE',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topics_tenant ON tenant_topics(tenant_id);

-- ============================================================
-- Content: Ghostwriter Posts
-- ============================================================
CREATE TABLE IF NOT EXISTS ghostwriter_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  language VARCHAR(10) DEFAULT 'de',
  category VARCHAR(100),
  angle VARCHAR(50),
  season VARCHAR(50),
  -- Blog
  blog_title VARCHAR(500),
  blog_slug VARCHAR(500),
  blog_body TEXT,
  blog_title_tag VARCHAR(70),
  blog_meta_description VARCHAR(160),
  blog_primary_keyword VARCHAR(200),
  blog_url VARCHAR(500),
  -- GBP
  gbp_text TEXT,
  gbp_post_id VARCHAR(255),
  -- Image
  image_url VARCHAR(500),
  image_alt_text VARCHAR(500),
  -- Status
  status VARCHAR(20) DEFAULT 'draft',
  error_message TEXT,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_tenant ON ghostwriter_posts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_lang ON ghostwriter_posts(tenant_id, language);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON ghostwriter_posts(tenant_id, language, blog_slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON ghostwriter_posts(status);

-- ============================================================
-- Pipeline Log
-- ============================================================
CREATE TABLE IF NOT EXISTS ghostwriter_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  post_id UUID REFERENCES ghostwriter_posts(id) ON DELETE SET NULL,
  step VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  duration_ms INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_tenant ON ghostwriter_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_log_post ON ghostwriter_log(post_id);

-- ============================================================
-- Phase 3: Cross-Client Network
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_network (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  partner_tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  relation_type VARCHAR(50) DEFAULT 'complementary',
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tenant_id, partner_tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_categories (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  industry_code VARCHAR(50),
  region_codes TEXT[]
);
