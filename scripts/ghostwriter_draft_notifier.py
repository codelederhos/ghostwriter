#!/usr/bin/env python3
"""
Zentraler Ghostwriter-Draft-Notifier (Core-Review-Flow, alle Tenants mit review_flow='core').

Findet ghostwriter_posts mit status='draft_review', die noch nicht benachrichtigt wurden,
erzeugt pro Post frische Preview-/Publish-Tokens (nur sha256-Hashes landen in der DB)
und schickt pro Post eine Telegram-Nachricht mit Inline-Buttons:
  - Vorschau ansehen  -> https://ghostwriter.code-lederhos.de/review/<previewToken>
  - Veröffentlichen   -> https://ghostwriter.code-lederhos.de/review/publish/<publishToken>

Routing pro Tenant: telegram_route_key/project_key -> routes.json (projects.<key>.chat_id),
Bot-Token aus tenant_settings.telegram_bot_token_file. Fallback: DM an FALLBACK_CHAT_ID
über den Default-Bot. ENV-Override NOTIFIER_FORCE_CHAT_ID für Tests.

Baurimmo (review_flow='client') bleibt beim bestehenden Client-Notifier und wird
hier bewusst NICHT angefasst.
"""

import argparse
import fcntl
import hashlib
import html
import json
import os
import secrets
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

GHOSTWRITER_DB_CONTAINER = os.environ.get("GHOSTWRITER_DB_CONTAINER", "ghostwriter-db-1")
GHOSTWRITER_DB_USER = os.environ.get("GHOSTWRITER_DB_USER", "ghostwriter")
GHOSTWRITER_DB_NAME = os.environ.get("GHOSTWRITER_DB_NAME", "ghostwriter")
ROUTES_FILE = os.environ.get("TELEGRAM_ROUTES_FILE", "/root/.codex/projects/telegram/routes.json")
DEFAULT_TOKEN_FILE = os.environ.get("DEFAULT_TELEGRAM_BOT_TOKEN_FILE", "/root/.codex/secrets/telegram_bot_token")
FALLBACK_CHAT_ID = os.environ.get("NOTIFIER_FALLBACK_CHAT_ID", "8591743701")
FORCE_CHAT_ID = os.environ.get("NOTIFIER_FORCE_CHAT_ID", "").strip()
PUBLIC_BASE = os.environ.get("REVIEW_PUBLIC_BASE", "https://ghostwriter.code-lederhos.de").rstrip("/")
LOCK_FILE = os.environ.get("DRAFT_NOTIFIER_LOCK_FILE", "/tmp/ghostwriter-draft-notifier.lock")
MAX_PER_RUN = 5  # Flutschutz: ein Lauf schickt nie mehr als 5 Nachrichten


def run_command(args, input_text=None, check=True, timeout=25):
    try:
        result = subprocess.run(
            args,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"command timed out after {timeout}s") from exc
    if check and result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    return result


def read_text_file(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


def sql_quote(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def ghostwriter_sql(sql, check=True, timeout=25):
    return run_command(
        ["docker", "exec", "-i", GHOSTWRITER_DB_CONTAINER, "psql",
         "-U", GHOSTWRITER_DB_USER, "-d", GHOSTWRITER_DB_NAME, "-At", "-c", sql],
        check=check,
        timeout=timeout,
    ).stdout.strip()


def resolve_project_chat_id(project_key):
    with open(ROUTES_FILE, "r", encoding="utf-8") as handle:
        routes = json.load(handle)
    project = (routes.get("projects") or {}).get(project_key) or {}
    chat_id = project.get("chat_id")
    if not chat_id:
        raise RuntimeError(f"telegram route missing for {project_key}")
    return str(chat_id)


def telegram_api(token, method, payload, timeout=12):
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=data)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def token_hash(token):
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def new_action_token():
    return secrets.token_urlsafe(32)


def acquire_lock():
    """Nicht-blockierendes Lock-File — verhindert parallele Läufe (Doppel-Nachrichten)."""
    handle = open(LOCK_FILE, "a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(f"pid={os.getpid()} started={datetime.now(timezone.utc).isoformat()}\n")
    handle.flush()
    return handle


def fetch_pending(limit, post_id=None):
    where = [
        "p.status = 'draft_review'",
        "p.review_notified_at IS NULL",
        "COALESCE(p.is_test, false) = false",
        "COALESCE(ts.review_flow, 'core') = 'core'",
    ]
    if post_id:
        where.append(f"p.id = {sql_quote(post_id)}::uuid")
    sql = f"""
      SELECT COALESCE(json_agg(row_to_json(t))::text, '[]')
      FROM (
        SELECT p.id::text, p.tenant_id::text, p.blog_title, p.blog_slug,
               p.category, p.language, p.qa_score, p.created_at,
               CASE WHEN jsonb_typeof(p.qa_issues) = 'object'
                    THEN COALESCE(p.qa_issues->>'gate_status', p.qa_issues->>'status')
               END AS gate_status,
               t.name AS tenant_name, t.slug AS tenant_slug,
               ts.telegram_route_key, ts.telegram_bot_token_file, ts.project_key
        FROM ghostwriter_posts p
        JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN tenant_settings ts ON ts.tenant_id = p.tenant_id
        WHERE {" AND ".join(where)}
        ORDER BY p.created_at ASC
        LIMIT {int(limit)}
      ) t;
    """
    return json.loads(ghostwriter_sql(sql) or "[]")


def issue_tokens(post_id):
    """Frische Tokens erzeugen; NUR die sha256-Hashes landen in der DB."""
    preview_token = new_action_token()
    publish_token = new_action_token()
    updated = ghostwriter_sql(
        f"""
        UPDATE ghostwriter_posts
        SET review_preview_token_hash = {sql_quote(token_hash(preview_token))},
            review_preview_token_created_at = NOW(),
            review_publish_token_hash = {sql_quote(token_hash(publish_token))},
            review_publish_token_created_at = NOW(),
            review_publish_token_used_at = NULL,
            review_publish_error = NULL,
            updated_at = NOW()
        WHERE id = {sql_quote(post_id)}::uuid
          AND status = 'draft_review'
          AND review_notified_at IS NULL
        RETURNING id::text;
        """
    ).strip()
    if not updated:
        return None
    return {
        "preview_url": f"{PUBLIC_BASE}/review/{urllib.parse.quote(preview_token, safe='')}",
        "publish_url": f"{PUBLIC_BASE}/review/publish/{urllib.parse.quote(publish_token, safe='')}",
    }


def mark_notified(post_id):
    ghostwriter_sql(
        f"""
        UPDATE ghostwriter_posts
        SET review_notified_at = NOW(), updated_at = NOW()
        WHERE id = {sql_quote(post_id)}::uuid;
        """
    )


def reset_post(post_id):
    """Benachrichtigung + Tokens zurücksetzen (Re-Test / erneuter Versand)."""
    ghostwriter_sql(
        f"""
        UPDATE ghostwriter_posts
        SET review_notified_at = NULL,
            review_preview_token_hash = NULL,
            review_preview_token_created_at = NULL,
            review_publish_token_hash = NULL,
            review_publish_token_created_at = NULL,
            review_publish_token_used_at = NULL,
            updated_at = NOW()
        WHERE id = {sql_quote(post_id)}::uuid;
        """
    )


def fmt_datum_de(value):
    """ISO-Timestamp (row_to_json) -> tt.mm.yyyy. Nie ISO roh in deutscher UI."""
    if not value:
        return ""
    try:
        parsed = datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except ValueError:
        return ""
    return parsed.strftime("%d.%m.%Y")


def qa_score_label(row):
    score = row.get("qa_score")
    if score is None:
        return "–"
    try:
        return f"{int(float(score))}/10"
    except (TypeError, ValueError):
        return str(score)


def build_message(row):
    tenant_label = row.get("tenant_name") or row.get("tenant_slug") or "Ghostwriter"
    title = row.get("blog_title") or "Ohne Titel"
    category = row.get("category") or "–"
    language = (row.get("language") or "de").upper()
    created = fmt_datum_de(row.get("created_at"))
    lines = [
        f"📝 <b>{html.escape(tenant_label)}: Artikel bereit zur Freigabe</b>",
        "",
        f"<b>{html.escape(title)}</b>",
        f"QA-Score: {html.escape(qa_score_label(row))} · Kategorie: {html.escape(category)} · Sprache: {html.escape(language)}",
    ]
    if created:
        lines.append(f"Erstellt: {created}")
    gate_status = row.get("gate_status")
    score = row.get("qa_score")
    low_score = False
    try:
        low_score = score is not None and float(score) < 5
    except (TypeError, ValueError):
        low_score = False
    if gate_status == "needs_revision" or low_score:
        lines.append("⚠️ QA empfiehlt Nacharbeit — bitte Vorschau besonders gründlich prüfen.")
    lines.append("")
    lines.append("Erst Vorschau prüfen, dann per Button veröffentlichen.")
    return "\n".join(lines)


def build_reply_markup(action_links):
    return json.dumps({
        "inline_keyboard": [
            [{"text": "Vorschau ansehen", "url": action_links["preview_url"]}],
            [{"text": "Veröffentlichen", "url": action_links["publish_url"]}],
        ],
    }, ensure_ascii=False)


def tenant_route_key(row):
    return (row.get("telegram_route_key") or "").strip() or (row.get("project_key") or "").strip() or (row.get("tenant_slug") or "").strip()


def tenant_token_file(row):
    return (row.get("telegram_bot_token_file") or "").strip() or DEFAULT_TOKEN_FILE


def send_telegram(row, message, reply_markup):
    """Route + Bot pro Tenant auflösen, bei Fehlern Fallback-DM über Default-Bot."""
    route_key = tenant_route_key(row)
    token_file = tenant_token_file(row)
    payload_base = {
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
        "reply_markup": reply_markup,
    }

    route_error = None
    try:
        token = read_text_file(token_file)
        if FORCE_CHAT_ID:
            chat_id = FORCE_CHAT_ID
        else:
            if not route_key:
                raise RuntimeError("no telegram route key for tenant")
            chat_id = resolve_project_chat_id(route_key)
        response = telegram_api(token, "sendMessage", dict(payload_base, chat_id=chat_id))
        result = response.get("result") or {}
        chat = result.get("chat") or {}
        chat_label = chat.get("title") or chat.get("username") or "chat"
        return f"route={route_key or 'forced'} message_id={result.get('message_id')} chat={chat_label}"
    except Exception as exc:
        route_error = str(exc)

    # Fallback: DM an FALLBACK_CHAT_ID über den Default-Bot
    fallback_message = (
        f"⚠️ Ghostwriter-Notifier: Route '{route_key or '-'}' für Tenant "
        f"{row.get('tenant_slug') or '-'} nicht sendbar, Fallback-DM.\n"
        f"Fehler: {route_error[:240]}\n\n" + message
    )
    token = read_text_file(DEFAULT_TOKEN_FILE)
    chat_id = FORCE_CHAT_ID or FALLBACK_CHAT_ID
    response = telegram_api(token, "sendMessage", dict(payload_base, chat_id=chat_id, text=fallback_message))
    result = response.get("result") or {}
    return f"fallback-dm message_id={result.get('message_id')} (route error)"


def main():
    parser = argparse.ArgumentParser(
        description="Telegram-Freigabe-Benachrichtigungen für Ghostwriter-Core-Review-Drafts (alle Tenants mit review_flow='core')."
    )
    parser.add_argument("--limit", type=int, default=MAX_PER_RUN, help=f"Max Nachrichten pro Lauf (hart gedeckelt auf {MAX_PER_RUN})")
    parser.add_argument("--post-id", help="Nur diesen Post benachrichtigen")
    parser.add_argument("--dry-run", action="store_true", help="Nachricht nur ausgeben, keine DB-Writes, kein Versand")
    parser.add_argument("--reset-post", help="review_notified_at + Tokens für diesen Post zurücksetzen")
    args = parser.parse_args()

    if args.reset_post:
        reset_post(args.reset_post)
        print(f"reset {args.reset_post}")
        return 0

    lock = None
    if not args.dry_run:
        lock = acquire_lock()
        if lock is None:
            print("another notifier run is in progress, exiting")
            return 0

    try:
        limit = max(1, min(args.limit, MAX_PER_RUN))
        rows = fetch_pending(limit, args.post_id)
        if not rows:
            print(f"{datetime.now(timezone.utc).isoformat()} no pending core-review drafts")
            return 0

        sent = 0
        errors = 0
        for row in rows:
            message = build_message(row)
            if args.dry_run:
                fake_links = {
                    "preview_url": f"{PUBLIC_BASE}/review/dry-run-preview-token",
                    "publish_url": f"{PUBLIC_BASE}/review/publish/dry-run-publish-token",
                }
                print(message)
                print(build_reply_markup(fake_links))
                print("---")
                continue

            action_links = issue_tokens(row["id"])
            if not action_links:
                print(f"skip {row['id']} (nicht mehr im Review-Status oder bereits benachrichtigt)")
                continue
            try:
                delivery_note = send_telegram(row, message, build_reply_markup(action_links))
                mark_notified(row["id"])
                sent += 1
                print(f"sent {row['id']} tenant={row.get('tenant_slug')} {delivery_note}")
            except Exception as exc:
                # review_notified_at bleibt NULL -> nächster Lauf versucht es erneut (mit frischen Tokens)
                errors += 1
                print(f"error {row['id']} tenant={row.get('tenant_slug')}: {exc}", file=sys.stderr)

        print(f"done sent={sent} errors={errors}")
        return 1 if (errors and not sent) else 0
    finally:
        if lock is not None:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
                lock.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
