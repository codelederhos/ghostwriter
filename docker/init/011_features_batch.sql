-- Migration 011: Features-Batch (Client-Integration, Refresh-Bot, SEO)

-- Feature 2: Public API + Client Push
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS client_api_url VARCHAR(500);
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS client_api_key TEXT;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS client_push_enabled BOOLEAN DEFAULT false;

-- Feature 5: Content Refresh Bot
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS refresh_enabled BOOLEAN DEFAULT false;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMP;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS refresh_count INTEGER DEFAULT 0;

-- Feature 1: SEO — updated_at für dateModified Signal
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Index: Refresh-Cron (Posts > 180 Tage, published)
CREATE INDEX IF NOT EXISTS idx_posts_refresh
  ON ghostwriter_posts(tenant_id, published_at)
  WHERE status = 'published';
