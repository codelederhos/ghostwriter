"""Orchestrierung: Export -> Medien -> Transkript -> Archiv -> PDF/Manifest."""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import __version__
from .media import (MediaIndex, archive_dir, audio_duration, extract_zips,
                    find_chat_files, safe_name, sha256_file, to_mp3)
from .model import Message
from .parser import chat_name_from_path, parse_export
from .pdf import build_pdf
from .transcribe import Transcriber, TranscriptCache, estimate_cost


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


@dataclass
class Options:
    inputs: list[str]
    out: Path
    media_pools: list[Path] = field(default_factory=list)
    me: str | None = None
    asr: str = "faster-whisper"
    model: str = "large-v3"
    language: str | None = "de"
    device: str = "auto"
    mp3_bitrate: str = "64k"
    emoji: str = "placeholder"
    emoji_font: str | None = None
    asr_prompt: str | None = None
    pdf_name: str = "WhatsApp_Gesamtverlauf.pdf"
    title: str = "WhatsApp Chatverlauf"
    since: dt.date | None = None
    until: dt.date | None = None
    timestamp_match: bool = True
    annex: bool = True
    dry_run: bool = False
    limit: int = 0
    workers: int = 4
    keep_media_kinds: tuple[str, ...] = ("voice", "audio")


def _split_input(raw: str) -> tuple[Path, str | None]:
    if "::" in raw:
        p, name = raw.rsplit("::", 1)
        return Path(p).expanduser(), name.strip() or None
    return Path(raw).expanduser(), None


def collect_messages(opts: Options, workdir: Path) -> list[Message]:
    """Entpackt Eingaben, parst alle Chat-Dateien, liefert sortierte Nachrichten."""
    messages: list[Message] = []
    extracted_roots: list[Path] = []

    for raw in opts.inputs:
        path, forced_name = _split_input(raw)
        if not path.exists():
            log(f"  ! Eingabe nicht gefunden: {path}")
            continue

        if path.suffix.lower() == ".zip":
            root = extract_zips([path], workdir)[0]
            extracted_roots.append(root)
            chat_files = find_chat_files(root)
            default_name = forced_name or chat_name_from_path(path)
        elif path.is_dir():
            extracted_roots.append(path)
            chat_files = find_chat_files(path)
            default_name = forced_name or path.name
        else:
            extracted_roots.append(path.parent)
            chat_files = [path]
            default_name = forced_name or chat_name_from_path(path)

        if not chat_files:
            log(f"  ! Keine Chat-Textdatei in {path}")
            continue
        for cf in chat_files:
            name = forced_name or (chat_name_from_path(cf)
                                   if cf.name != "_chat.txt" else default_name)
            found = parse_export(cf, chat=name)
            log(f"  + {name}: {len(found)} Nachrichten aus {cf.name}")
            messages += found

    opts.media_pools = list(opts.media_pools) + extracted_roots
    messages.sort(key=lambda m: (m.timestamp, m.chat, m.line_no))

    if opts.since:
        messages = [m for m in messages if m.date_key >= opts.since]
    if opts.until:
        messages = [m for m in messages if m.date_key <= opts.until]
    return messages


def resolve_media(messages: list[Message], opts: Options) -> MediaIndex:
    """Ordnet jedem Anhang eine Datei im Medienbestand zu."""
    index = MediaIndex(opts.media_pools)
    log(f"  Medienbestand: {index.total} Dateien indiziert")
    used: set[Path] = set()
    for m in messages:
        for a in m.attachments:
            a.match_mode = index.resolve(a, m, used, opts.timestamp_match)
    return index


def archive_and_convert(messages: list[Message], opts: Options) -> None:
    """Kopiert Originale in die Datumsstruktur und erzeugt MP3-Fassungen."""
    base = opts.out / "Medien"
    jobs = []
    for m in messages:
        for a in m.attachments:
            if not a.resolved_path or a.kind not in opts.keep_media_kinds:
                continue
            src = Path(a.resolved_path)
            target_dir = archive_dir(base, m.chat, m.timestamp)
            stamp = m.timestamp.strftime("%Y-%m-%d_%H-%M")
            stem = f"{stamp}_{safe_name(m.sender or 'Unbekannt')}_{safe_name(src.stem)}"
            jobs.append((a, src, target_dir, stem))

    def work(job):
        a, src, target_dir, stem = job
        target_dir.mkdir(parents=True, exist_ok=True)
        original = target_dir / f"{stem}{src.suffix.lower()}"
        if not original.exists():
            shutil.copy2(src, original)
        a.archive_path = str(original)
        a.sha256 = sha256_file(original)
        a.duration_s = audio_duration(original)
        mp3 = target_dir / f"{stem}.mp3"
        if src.suffix.lower() == ".mp3":
            a.mp3_path = str(original)
        elif to_mp3(original, mp3, opts.mp3_bitrate):
            a.mp3_path = str(mp3)
        return a

    if not jobs:
        return
    log(f"  Archiviere und konvertiere {len(jobs)} Audiodateien ...")
    with ThreadPoolExecutor(max_workers=opts.workers) as pool:
        for i, _ in enumerate(pool.map(work, jobs), 1):
            if i % 25 == 0 or i == len(jobs):
                log(f"    {i}/{len(jobs)}")


def transcribe_all(messages: list[Message], opts: Options) -> int:
    """Transkribiert alle Sprachnachrichten. Nutzt den Cache, ueberspringt Bekanntes."""
    if opts.asr == "none":
        return 0
    opts.asr = resolve_backend(opts)
    cache = TranscriptCache(opts.out / "_cache" / "transkripte.json")
    tr = Transcriber(opts.asr, opts.model, opts.language, opts.device,
                     prompt=opts.asr_prompt)

    todo = [(m, a) for m in messages for a in m.attachments
            if a.kind in ("voice", "audio") and a.archive_path and a.sha256]
    if not todo:
        return 0
    log(f"  Transkribiere {len(todo)} Sprachnachrichten (Engine {tr.engine_id}) ...")

    def run(item):
        m, a = item
        hit = cache.get(a.sha256)
        if hit:
            a.transcript, a.transcript_lang = hit["text"], hit.get("lang")
            a.transcript_engine = hit.get("engine")
            return True
        # Fuer die API die kleinere MP3 nutzen, lokal das verlustfreie Original.
        src = Path(a.mp3_path if (opts.asr == "openai" and a.mp3_path) else a.archive_path)
        try:
            res = tr.transcribe(src)
        except Exception as exc:                      # eine Datei darf den Lauf nicht kippen
            log(f"    ! Fehler bei {a.filename}: {exc}")
            return False
        a.transcript, a.transcript_lang = res["text"], res["lang"]
        a.transcript_engine = res["engine"]
        cache.put(a.sha256, res)
        return True

    done = 0
    if opts.asr == "openai":
        with ThreadPoolExecutor(max_workers=opts.workers) as pool:
            for i, ok in enumerate(pool.map(run, todo), 1):
                done += bool(ok)
                if i % 10 == 0 or i == len(todo):
                    log(f"    {i}/{len(todo)}")
                    cache.save()
    else:
        for i, item in enumerate(todo, 1):
            done += bool(run(item))
            if i % 5 == 0 or i == len(todo):
                log(f"    {i}/{len(todo)}")
                cache.save()
    cache.save()
    return sum(1 for _, a in todo if a.transcript)


def write_manifest(messages: list[Message], opts: Options) -> tuple[Path, Path]:
    """Schreibt Manifest als CSV und JSON (vollstaendiger, maschinenlesbarer Verlauf)."""
    csv_path = opts.out / "Manifest.csv"
    json_path = opts.out / "Verlauf.json"
    fields = ["chat", "datum", "uhrzeit", "absender", "richtung", "text", "typ",
              "dateiname", "dauer", "sha256", "quelle", "archiv", "mp3",
              "zuordnung", "engine", "transkript"]
    rows, blob = [], []
    for m in messages:
        direction = "gesendet" if (opts.me and m.sender == opts.me) else "empfangen"
        base = {
            "chat": m.chat, "datum": m.timestamp.strftime("%Y-%m-%d"),
            "uhrzeit": m.timestamp.strftime("%H:%M:%S"),
            "absender": m.sender or ("SYSTEM" if m.is_system else ""),
            "richtung": "system" if m.is_system else direction, "text": m.text,
        }
        if not m.attachments:
            rows.append({**base, "typ": "text"})
        for a in m.attachments:
            rows.append({**base, "typ": a.kind, "dateiname": a.filename,
                         "dauer": a.duration_hms if a.duration_s else "",
                         "sha256": a.sha256 or "", "quelle": a.resolved_path or "",
                         "archiv": a.archive_path or "", "mp3": a.mp3_path or "",
                         "zuordnung": a.match_mode or "", "engine": a.transcript_engine or "",
                         "transkript": a.transcript or ""})
        blob.append({
            **base, "quelldatei": m.source_file, "zeile": m.line_no,
            "anhaenge": [{"datei": a.filename, "typ": a.kind, "dauer_s": a.duration_s,
                          "sha256": a.sha256, "original": a.resolved_path,
                          "archiv": a.archive_path, "mp3": a.mp3_path,
                          "zuordnung": a.match_mode, "transkript": a.transcript,
                          "engine": a.transcript_engine} for a in m.attachments],
        })
    opts.out.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    json_path.write_text(json.dumps(
        {"werkzeug": f"wa_forensics {__version__}",
         "erstellt": dt.datetime.now().isoformat(timespec="seconds"),
         "nachrichten": blob}, ensure_ascii=False, indent=1), "utf-8")
    return csv_path, json_path


def build_stats(messages: list[Message]) -> dict:
    voice = [a for m in messages for a in m.attachments if a.kind in ("voice", "audio")]
    days = [m.date_key for m in messages]
    rng = "-"
    if days:
        rng = f"{min(days).strftime('%d.%m.%Y')} bis {max(days).strftime('%d.%m.%Y')}"
    total_s = sum(a.duration_s or 0 for a in voice)
    return {
        "messages": len(messages), "voice": len(voice),
        "transcribed": sum(1 for a in voice if a.transcript),
        "media": sum(1 for a in voice if a.archive_path),
        "range": rng, "audio_seconds": total_s,
        "days": len(set(days)),
    }


def resolve_backend(opts: Options) -> str:
    """Loest 'auto' auf: API wenn Schluessel und Paket da sind, sonst lokal."""
    if opts.asr != "auto":
        return opts.asr
    import importlib.util
    if os.environ.get("OPENAI_API_KEY") and importlib.util.find_spec("openai"):
        if opts.model.startswith("large") or opts.model in ("tiny", "base", "small", "medium"):
            opts.model = "whisper-1"
        log(f"    Backend automatisch gewaehlt: openai ({opts.model})")
        return "openai"
    if opts.model == "whisper-1":
        opts.model = "large-v3"
    log(f"    Backend automatisch gewaehlt: faster-whisper ({opts.model})")
    return "faster-whisper"


def document_id(messages: list[Message]) -> str:
    """Kennung des Protokolls: SHA-256 ueber Nachrichten und Mediensummen."""
    h = hashlib.sha256()
    for m in messages:
        h.update(f"{m.timestamp.isoformat()}|{m.chat}|{m.sender}|{m.text}".encode())
        for a in m.attachments:
            h.update(f"|{a.filename}|{a.sha256 or ''}|{a.transcript or ''}".encode())
    return h.hexdigest()[:16]


def run(opts: Options) -> dict:
    opts.out = Path(opts.out).expanduser()
    workdir = opts.out / "_entpackt"
    workdir.mkdir(parents=True, exist_ok=True)

    log("1/6 Exporte einlesen")
    messages = collect_messages(opts, workdir)
    if not messages:
        raise SystemExit("Keine Nachrichten gefunden. Stimmen die Eingabepfade?")
    if opts.limit:
        messages = messages[:opts.limit]

    log("2/6 Medien zuordnen")
    resolve_media(messages, opts)
    stats = build_stats(messages)
    log(f"    {stats['voice']} Sprachnachrichten in {stats['messages']} Nachrichten")

    if opts.dry_run:
        voice = [a for m in messages for a in m.attachments
                 if a.kind in ("voice", "audio")]
        found = [a for a in voice if a.resolved_path]
        seconds = 0.0
        for a in found:
            a.duration_s = audio_duration(Path(a.resolved_path))
            seconds += a.duration_s or 0
        by_mode = Counter(a.match_mode for a in voice)
        chats = Counter(m.chat for m in messages)

        log("\nProbelauf. Es wurde nichts geschrieben.")
        log(f"  Zeitraum:           {stats['range']} ({stats['days']} Kalendertage)")
        log(f"  Nachrichten:        {stats['messages']}")
        for name, cnt in chats.most_common():
            log(f"      {name}: {cnt}")
        log(f"  Sprachnachrichten:  {len(voice)} gefunden, {len(found)} zugeordnet")
        log(f"      exakt ueber Dateiname: {by_mode.get('exact', 0)}")
        log(f"      ueber Zeitstempel:     {by_mode.get('timestamp', 0)}")
        log(f"      nicht auffindbar:      {by_mode.get('missing', 0)}")
        log(f"  Audiolaufzeit:      {seconds / 60:.0f} Minuten")
        if opts.asr == "openai":
            cost = estimate_cost(seconds, opts.model)
            if cost is not None:
                log(f"  Transkription:      rund {cost:.2f} USD ueber {opts.model}")
            else:
                log(f"  Transkription:      Modell {opts.model}, Preis unbekannt")
        elif opts.asr == "faster-whisper":
            log(f"  Transkription:      lokal mit {opts.model}, "
                f"grob {seconds / 60 * 0.4:.0f} bis {seconds / 60 * 1.5:.0f} Minuten auf CPU")
        stats["audio_seconds"] = seconds
        return stats

    log("3/6 Originale archivieren und MP3 erzeugen")
    archive_and_convert(messages, opts)

    log("4/6 Sprachnachrichten transkribieren")
    transcribe_all(messages, opts)

    log("5/6 Manifest schreiben")
    csv_path, json_path = write_manifest(messages, opts)

    log("6/6 PDF erzeugen")
    stats = build_stats(messages)
    chats = sorted(set(m.chat for m in messages))
    doc_id = document_id(messages)
    engines = sorted({a.transcript_engine for m in messages for a in m.attachments
                      if a.transcript_engine})
    notes = [
        "Quelle sind die von WhatsApp erzeugten Chat-Exporte, unverändert eingelesen.",
        "Zeitangaben stammen aus dem Export und folgen der lokalen Zeitzone des Exportgeräts.",
        "Sprachnachrichten sind maschinell transkribiert" +
        (f" ({', '.join(engines)})." if engines else "."),
        "Transkripte können Hörfehler enthalten. Maßgeblich ist stets die Originaldatei.",
        "Jede archivierte Originaldatei ist per SHA-256 in der Anlage ausgewiesen.",
        "Originale liegen unverändert im Ordner Medien, die MP3-Fassung ist eine reine "
        "Formatwandlung zum Abhören.",
        "Medien ohne Dateinamen im Export sind über den Zeitstempel zugeordnet und in der "
        "Anlage sowie im Manifest als solche gekennzeichnet.",
        f"Die Dokumentkennung {doc_id} ist der SHA-256 über alle Nachrichten und "
        "Mediensummen dieses Protokolls.",
    ]
    pdf_path = build_pdf(messages, opts.out / opts.pdf_name, title=opts.title,
                         chats=chats, me=opts.me, doc_id=doc_id, emoji_mode=opts.emoji,
                         emoji_font_path=opts.emoji_font,
                         include_annex=opts.annex, stats=stats, method_notes=notes)

    log("\nFertig.")
    log(f"  PDF:      {pdf_path}")
    log(f"  Manifest: {csv_path}")
    log(f"  JSON:     {json_path}")
    log(f"  Medien:   {opts.out / 'Medien'}")
    return stats
