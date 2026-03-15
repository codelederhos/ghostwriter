# Ghostwriter — Projekt-Anweisungen

## Projekt
Autonomes SEO-Content-System als Multi-Tenant SaaS.
Generiert Blog-Artikel + GBP-Posts vollautonom.

## Stack
- Next.js 14 (App Router, standalone output)
- PostgreSQL 16 (Docker)
- Tailwind CSS, Lucide Icons
- node-cron Scheduler (alle 30 Min)

## Workflow
- Branch: `main` (single branch)
- Deploy: `ssh n8n 'cd /opt/ghostwriter && git pull && docker compose build app && docker compose up -d'`
- Lokal: `npm run dev` (Port 3200)
- Nach jedem Deploy: RAG-Eintrag (Tags: ghostwriter, changelog)

## Env-Vars (docker-compose.yml)
- `DATABASE_URL` — PostgreSQL Connection String
- `ENCRYPTION_KEY` — AES-256-GCM für API-Key-Verschlüsselung
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Admin-Login
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — LLM Provider (optional, pro Tenant konfigurierbar)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — GBP OAuth2
- `SMTP_*` — E-Mail Reporting

## Architektur
- 5-Step Pipeline: Planer → SEO → Texter → Bild → Publisher
- Multi-Tenant: Jeder Tenant hat eigenes Profil, Topics, API-Keys, Settings
- Provider-Interfaces: Text (Claude/GPT/Mistral/Custom), Bild (DALL-E/Flux/Stock/Custom)
- Blog-Hosting: /{tenant}/{lang}/blog/

## Wichtige Dateien
- `lib/pipeline/` — Pipeline-Engine
- `lib/providers/` — Text + Bild Provider
- `lib/db.js` — PostgreSQL Pool
- `lib/crypto.js` — AES-256-GCM
- `lib/auth.js` — Session-Management
- `docker/init/001_schema.sql` — DB Schema
- `instrumentation.js` — Scheduler-Start

## Regeln
- Tailwind Custom CSS IMMER in `@layer components { }` (sonst überschreibt es Utilities)
- Server Components die DB-Queries machen: `export const dynamic = 'force-dynamic'` setzen
- UI-Skill laden vor visueller Arbeit: `~/.codex/skills/ui-animations/SKILL.md`
- Nach Änderungen: RAG ingestieren (Tags: ghostwriter, changelog)
