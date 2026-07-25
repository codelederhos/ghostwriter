-- Migration 017: SEO Hub — Programmatic Landing Pages + Intelligence Layer

-- ─── PAGE TYPES (Slug-Templates pro Tenant) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_page_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug_template   VARCHAR(100) NOT NULL,
  slug_per_lang   JSONB DEFAULT '{}',
  category        VARCHAR(50),
  title_template  VARCHAR(255),
  h1_template     VARCHAR(255),
  desc_template   TEXT,
  schema_type     VARCHAR(50) DEFAULT 'LocalBusiness',
  ki_style_sample TEXT,
  cta_positions   JSONB DEFAULT '["after_intro","before_faq"]',
  internal_link_count INT DEFAULT 4,
  min_words       INT DEFAULT 700,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_page_types_tenant ON seo_page_types(tenant_id);

-- ─── LOCATIONS / ORTE ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            JSONB NOT NULL,
  slug            JSONB NOT NULL,
  state           VARCHAR(50),
  country         CHAR(2) DEFAULT 'DE',
  lat             DECIMAL(9,6),
  lng             DECIMAL(9,6),
  population      INT,
  distance_km     INT,
  local_spots     JSONB DEFAULT '{}',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SEO PAGES (eine Zeile = eine Sprache einer Seite) ───────────────────────
CREATE TABLE IF NOT EXISTS seo_pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_type_id    UUID NOT NULL REFERENCES seo_page_types(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES seo_locations(id) ON DELETE CASCADE,
  lang            VARCHAR(5) NOT NULL,
  slug            VARCHAR(255) NOT NULL,

  -- Meta
  title           VARCHAR(255),
  h1              VARCHAR(255),
  meta_description TEXT,

  -- Content (KI-generiert)
  intro_html      TEXT,
  local_html      TEXT,
  practical_html  TEXT,
  faq_json        JSONB DEFAULT '[]',

  -- SEO-Extras
  schema_org      JSONB,
  image_alts      JSONB DEFAULT '{}',
  internal_links  JSONB DEFAULT '[]',

  -- Sitemap
  priority        DECIMAL(2,1) DEFAULT 0.7,
  changefreq      VARCHAR(20) DEFAULT 'monthly',

  -- Workflow
  status          VARCHAR(20) DEFAULT 'draft',
  ki_generated_at TIMESTAMPTZ,
  reviewed_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, slug, lang)
);

CREATE INDEX IF NOT EXISTS idx_seo_pages_tenant ON seo_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_seo_pages_status ON seo_pages(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_pages_slug ON seo_pages(tenant_id, slug, lang);
CREATE INDEX IF NOT EXISTS idx_seo_pages_type_loc ON seo_pages(page_type_id, location_id, lang);

-- ─── HREFLANG-MAPPING ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_page_translations (
  page_type_id    UUID NOT NULL REFERENCES seo_page_types(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES seo_locations(id) ON DELETE CASCADE,
  lang_de         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_en         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_es         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_it         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_fr         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_ru         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  lang_ro         UUID REFERENCES seo_pages(id) ON DELETE SET NULL,
  PRIMARY KEY(page_type_id, location_id)
);

-- ─── TÄGLICHE METRIKEN PRO SEITE (GSC + Analytics) ───────────────────────────
CREATE TABLE IF NOT EXISTS seo_page_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id             UUID NOT NULL REFERENCES seo_pages(id) ON DELETE CASCADE,
  date                DATE NOT NULL,

  -- Google Search Console
  gsc_impressions     INT DEFAULT 0,
  gsc_clicks          INT DEFAULT 0,
  gsc_ctr             DECIMAL(6,5) DEFAULT 0,
  gsc_position        DECIMAL(5,2) DEFAULT 0,
  gsc_top_queries     JSONB DEFAULT '[]',

  -- Analytics (via analytics-mcp)
  ana_sessions        INT DEFAULT 0,
  ana_bounces         INT DEFAULT 0,
  ana_duration_avg_s  INT DEFAULT 0,
  ana_cta_clicks      INT DEFAULT 0,
  ana_cta_breakdown   JSONB DEFAULT '{}',
  ana_scroll_50pct    INT DEFAULT 0,

  UNIQUE(page_id, date)
);

CREATE INDEX IF NOT EXISTS idx_seo_metrics_page_date ON seo_page_metrics(page_id, date DESC);

-- ─── DIAGNOSE-FLAGS PRO SEITE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_page_diagnostics (
  page_id               UUID PRIMARY KEY REFERENCES seo_pages(id) ON DELETE CASCADE,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  flag_not_indexed      BOOLEAN DEFAULT FALSE,
  flag_ctr_low          BOOLEAN DEFAULT FALSE,
  flag_bounce_high      BOOLEAN DEFAULT FALSE,
  flag_no_cta           BOOLEAN DEFAULT FALSE,
  flag_position_drop    BOOLEAN DEFAULT FALSE,
  flag_near_page1       BOOLEAN DEFAULT FALSE,
  flag_keyword_gap      BOOLEAN DEFAULT FALSE,

  keyword_gaps          JSONB DEFAULT '[]',
  suggestions           JSONB DEFAULT '[]',
  severity              VARCHAR(10) DEFAULT 'ok'
);

CREATE INDEX IF NOT EXISTS idx_seo_diagnostics_severity ON seo_page_diagnostics(severity);
