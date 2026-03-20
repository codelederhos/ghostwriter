-- Drive Sync Fortschritt
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS drive_sync_status TEXT DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS drive_sync_total INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_done INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_added INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sync_started_at BIGINT;
