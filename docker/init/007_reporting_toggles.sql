-- Reporting Toggles: Telegram und E-Mail einzeln aktivieren/deaktivieren
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN DEFAULT false;
