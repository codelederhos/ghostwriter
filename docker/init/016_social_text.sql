-- Migration 016: social_text als eigenes Feld (unabhängig von gbp_text)
ALTER TABLE ghostwriter_posts
  ADD COLUMN IF NOT EXISTS social_text TEXT;
