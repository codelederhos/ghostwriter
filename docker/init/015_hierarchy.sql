-- 015: Hierarchie für tenant_properties (parent_id)
ALTER TABLE tenant_properties
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tenant_properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_properties_parent ON tenant_properties(parent_id);
