-- 014: Objekte/Standorte für Referenzbilder + Sequenz-Verlinkung
CREATE TABLE IF NOT EXISTS tenant_properties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  address       TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  type          TEXT DEFAULT 'haus',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tenant_reference_images
  ADD COLUMN IF NOT EXISTS property_id    UUID REFERENCES tenant_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_group UUID;

CREATE INDEX IF NOT EXISTS idx_ref_images_property ON tenant_reference_images(property_id);
CREATE INDEX IF NOT EXISTS idx_ref_images_sequence ON tenant_reference_images(sequence_group);
CREATE INDEX IF NOT EXISTS idx_properties_tenant   ON tenant_properties(tenant_id);
