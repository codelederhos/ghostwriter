-- Zentraler Review-Flow: Tokens + Notifier-Status auf ghostwriter_posts,
-- review_flow pro Tenant ('core' = Ghostwriter-Admin-Workspace, 'client' = Client-App wie Baurimmo)

ALTER TABLE ghostwriter_posts
  ADD COLUMN IF NOT EXISTS review_preview_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS review_preview_token_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_publish_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS review_publish_token_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_publish_token_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_publish_result JSONB,
  ADD COLUMN IF NOT EXISTS review_publish_error TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_review_preview_token
  ON ghostwriter_posts(review_preview_token_hash)
  WHERE review_preview_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_review_publish_token
  ON ghostwriter_posts(review_publish_token_hash)
  WHERE review_publish_token_hash IS NOT NULL;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS review_flow TEXT DEFAULT 'core';

-- Baurimmo behaelt den bestehenden Client-Flow (eigene Drafts-Tabelle + Immi-Notifier)
UPDATE tenant_settings SET review_flow = 'client'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'baur-immobilien');
