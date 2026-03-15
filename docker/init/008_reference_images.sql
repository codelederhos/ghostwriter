-- Referenzbilder pro Tenant (Persona + Post-Bilder)
CREATE TABLE IF NOT EXISTS tenant_reference_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'persona' oder 'post'
    image_url TEXT NOT NULL,
    description TEXT,
    slot_index INTEGER, -- für Persona: 0-3
    categories TEXT[] DEFAULT '{}', -- für Post-Bilder: zugeordnete Kategorie-Labels
    created_at TIMESTAMP DEFAULT NOW()
);

-- Persona-Vorgabetext (wie die 4 Bilder aussehen sollen)
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS persona_guidelines TEXT;

-- Custom Image Endpoint
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS image_custom_endpoint VARCHAR(500);
