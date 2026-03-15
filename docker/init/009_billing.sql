-- Pricing Config in system_config
INSERT INTO system_config (key, value) VALUES
('pricing', '{
  "post_price_cents": 300,
  "backlink_price_cents": 100,
  "membership_monthly_cents": 0,
  "note": "Preise in Cent. 300 = 3 EUR pro Post."
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Abrechnungszeiträume pro Tenant
CREATE TABLE IF NOT EXISTS billing_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'invoiced', 'paid'
    post_count INTEGER DEFAULT 0,
    backlink_count INTEGER DEFAULT 0,
    post_total_cents INTEGER DEFAULT 0,
    backlink_total_cents INTEGER DEFAULT 0,
    membership_cents INTEGER DEFAULT 0,
    total_cents INTEGER DEFAULT 0,
    invoiced_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
