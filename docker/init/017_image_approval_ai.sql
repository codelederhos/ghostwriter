-- Migration 017: Bild-Freigabe + KI-Generierungs-Tracking
-- Neue Spalten auf tenant_reference_images für:
-- 1. Freigabe-Workflow (approval_status, approval_note, approved_at)
-- 2. KI-Stammbaum (parent_image_id, is_ai_generated, generation_prompt, generation_provider, generation_model)

ALTER TABLE tenant_reference_images
  ADD COLUMN IF NOT EXISTS parent_image_id      UUID REFERENCES tenant_reference_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_ai_generated      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS generation_prompt     TEXT,
  ADD COLUMN IF NOT EXISTS generation_provider   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS generation_model      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS approval_status       VARCHAR(20) DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_note         TEXT,
  ADD COLUMN IF NOT EXISTS approved_at           TIMESTAMP;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ref_images_parent   ON tenant_reference_images(parent_image_id);
CREATE INDEX IF NOT EXISTS idx_ref_images_approval ON tenant_reference_images(approval_status);
CREATE INDEX IF NOT EXISTS idx_ref_images_ai       ON tenant_reference_images(is_ai_generated);

-- Bestehende Bilder sind bereits in Benutzung → approved
UPDATE tenant_reference_images
  SET approval_status = 'approved', approved_at = NOW()
  WHERE approval_status IS NULL OR approval_status = 'approved';
