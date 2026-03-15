ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS ctas JSONB DEFAULT '[
  {"key": "CALL", "label": "Anrufen", "type": "phone", "channels": [{"type": "phone", "label": "Büro", "value": ""}]},
  {"key": "LEARN_MORE", "label": "Mehr erfahren", "type": "link", "channels": [{"type": "url", "label": "Website", "value": ""}]},
  {"key": "WHATSAPP", "label": "WhatsApp", "type": "whatsapp", "channels": [{"type": "whatsapp", "label": "WhatsApp", "value": ""}]},
  {"key": "EMAIL", "label": "E-Mail schreiben", "type": "email", "channels": [{"type": "email", "label": "E-Mail", "value": ""}]},
  {"key": "SOCIAL", "label": "Social Media", "type": "social", "channels": [{"type": "instagram", "label": "Instagram", "value": ""}, {"type": "facebook", "label": "Facebook", "value": ""}]}
]';
