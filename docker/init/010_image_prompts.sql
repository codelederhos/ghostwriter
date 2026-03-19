-- Migration 010: Image-Prompts + QA-Spalten speichern
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS image_prompt_1 TEXT;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS image_prompt_2 TEXT;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS image_alt_text_2 TEXT;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS qa_score SMALLINT;
ALTER TABLE ghostwriter_posts ADD COLUMN IF NOT EXISTS qa_issues JSONB DEFAULT '[]'::jsonb;
