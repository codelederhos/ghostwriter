-- 3-Ebenen-System: Kategorie × Angle × Saison = 240+ unique Kombinationen
ALTER TABLE tenant_topics ADD COLUMN IF NOT EXISTS angles JSONB DEFAULT '[
  {"key": 1, "label": "Zahlenfakt / Rechenbeispiel", "active": true},
  {"key": 2, "label": "Kundenperspektive / Testimonial", "active": true},
  {"key": 3, "label": "FAQ / Frage-Antwort", "active": true},
  {"key": 4, "label": "Vergleich / Andere vs. Wir", "active": true},
  {"key": 5, "label": "Tipp / Actionable Advice", "active": true}
]';
