-- Billing Mode: own_key (Kunde hat eigenen Key) oder platform (Code-Lederhos Key, Abrechnung pro Post)
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) DEFAULT 'own_key';

-- Backlinks als Option pro Tenant
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS backlinks_enabled BOOLEAN DEFAULT false;

-- Kosten-Tracking pro Post
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS cost_cents INTEGER DEFAULT 0;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) DEFAULT 'own_key';

-- Zweites Bild pro Post (GBP-Bild)
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS image_url_2 TEXT;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS image_alt_text_2 TEXT;

-- Default Bild-Modell in system_config
INSERT INTO system_config (key, value) VALUES
('recommended_image_models', '{
  "dalle3": {"model": "dall-e-3", "label": "DALL-E 3", "cost_cents": 4},
  "flux": {"model": "flux-schnell", "label": "Flux Schnell", "cost_cents": 1},
  "gemini": {"model": "gemini-2.0-flash-exp", "label": "Gemini Flash", "cost_cents": 1}
}'::jsonb),
('platform_pricing', '{
  "price_per_post_cents": 300,
  "includes": "Text (SEO + Artikel + GBP) + 2 Bilder",
  "note": "~€3 pro Post All-Inclusive"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
