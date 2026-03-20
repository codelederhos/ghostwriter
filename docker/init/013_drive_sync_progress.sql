-- Drive Sync Fortschritt
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS drive_sync_status TEXT DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS drive_sync_total INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_done INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_added INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_started_at BIGINT;

-- KI-Bildanalyse Felder
ALTER TABLE tenant_reference_images
  ADD COLUMN IF NOT EXISTS ai_analyzed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS room_type TEXT,
  ADD COLUMN IF NOT EXISTS condition_tag TEXT,
  ADD COLUMN IF NOT EXISTS ai_tags TEXT[];
