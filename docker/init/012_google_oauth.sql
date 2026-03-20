-- Migration 012: Google OAuth (Drive + GBP) Integration
-- Reuses gbp_oauth_token / gbp_refresh_token columns as unified Google tokens

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS google_token_expiry BIGINT,
  ADD COLUMN IF NOT EXISTS google_scopes TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_name TEXT,
  ADD COLUMN IF NOT EXISTS drive_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gbp_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_custom_endpoint TEXT;

-- Track source of reference images (upload / drive)
ALTER TABLE tenant_reference_images
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS source_id TEXT;
