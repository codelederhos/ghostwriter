-- System Config (key-value store for global settings)
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Default recommended models
INSERT INTO system_config (key, value) VALUES
('recommended_models', '{
  "anthropic": {"model": "claude-sonnet-4-20250514", "label": "Claude Sonnet 4", "ctx": "200k"},
  "openai": {"model": "gpt-4.1-mini", "label": "GPT-4.1 Mini", "ctx": "1M"},
  "mistral": {"model": "mistral-large-latest", "label": "Mistral Large", "ctx": "128k"}
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Add is_test flag to posts for test/preview tracking
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;
