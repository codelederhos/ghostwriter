-- Brute-Force-Schutz für den Login: IP- + Account-basiertes Rate-Limiting.
CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  email TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts (created_at);
