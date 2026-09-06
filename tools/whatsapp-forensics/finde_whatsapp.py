#!/usr/bin/env python3
"""Sucht WhatsApp-Exporte und Sprachnachrichten auf diesem Rechner.

Durchsucht Downloads und weitere uebliche Orte, erkennt Chat-Exporte in ZIPs
und als lose .txt, zaehlt Nachrichten und Sprachnachrichten und schlaegt am
Ende den fertigen Aufruf fuer wa_forensics.py vor.

Aufruf:
    python3 finde_whatsapp.py                  # Standardorte durchsuchen
    python3 finde_whatsapp.py PFAD [PFAD ...]  # eigene Ordner durchsuchen
    python3 finde_whatsapp.py --tief           # ganzes Benutzerverzeichnis
"""

from __future__ import annotations

import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wa_forensics.parser import chat_name_from_path, parse_export   # noqa: E402

AUDIO_EXT = {".opus", ".ogg", ".m4a", ".aac", ".amr", ".mp3", ".wav"}
CHAT_HINT = re.compile(r"^\s*[\[]?\d{1,4}[./-]\d{1,2}[./-]\d{2,4},?\s+\d{1,2}:\d{2}")
SKIP_DIRS = {"node_modules", ".git", "Library", "AppData", "$Recycle.Bin",
             "Windows", "Program Files", "Program Files (x86)", ".cache", "venv"}


def default_roots() -> list[Path]:
    home = Path.home()
    names = ["Downloads", "Download", "Desktop", "Schreibtisch", "Documents",
             "Dokumente", "WhatsApp", "Downloads/WhatsApp"]
    roots = [home / n for n in names]
    for base in (Path("/mnt/c/Users"), Path("/media"), Path("/run/media"), Path("/Volumes")):
        if base.exists():
            for sub in base.iterdir():
                roots += [sub / "Downloads", sub / "Download", sub]
    return [r for r in dict.fromkeys(roots) if r.exists()]


def walk(root: Path):
    """Dateien liefern, uninteressante Verzeichnisse ueberspringen."""
    stack = [root]
    while stack:
        cur = stack.pop()
        try:
            for entry in cur.iterdir():
                if entry.is_dir():
                    if entry.name in SKIP_DIRS or entry.name.startswith("."):
                        continue
                    stack.append(entry)
                else:
                    yield entry
        except (PermissionError, OSError):
            continue


def looks_like_chat(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for _ in range(30):
                line = fh.readline()
                if not line:
                    break
                if CHAT_HINT.match(line.replace("‎", "")):
                    return True
    except OSError:
        return False
    return False


def summarize(messages, label: str, source: str, extra: str = "") -> dict:
    voice = [a for m in messages for a in m.attachments if a.kind in ("voice", "audio")]
    named = [a for a in voice if a.filename]
    days = sorted({m.date_key for m in messages})
    senders = Counter(m.sender for m in messages if m.sender)
    return {
        "label": label, "source": source, "extra": extra,
        "fingerprint": (len(messages), days[0] if days else None,
                        days[-1] if days else None, tuple(sorted(senders))),
        "media_in_zip": 0,
        "messages": len(messages), "voice": len(voice), "named": len(named),
        "von": days[0].strftime("%d.%m.%Y") if days else "-",
        "bis": days[-1].strftime("%d.%m.%Y") if days else "-",
        "teilnehmer": [n for n, _ in senders.most_common(5)],
    }


def scan_zip(path: Path) -> list[dict]:
    out = []
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            chats = [n for n in names if n.endswith(".txt")]
            media = [n for n in names if Path(n).suffix.lower() in AUDIO_EXT]
            for chat in chats:
                tmp = Path(f"/tmp/_wa_scan_{abs(hash(path.name + chat))}.txt")
                tmp.write_bytes(zf.read(chat))
                try:
                    msgs = parse_export(tmp, chat=chat_name_from_path(path))
                finally:
                    tmp.unlink(missing_ok=True)
                if msgs:
                    entry = summarize(msgs, chat_name_from_path(path), str(path),
                                      f"{len(media)} Mediendateien im ZIP")
                    entry["media_in_zip"] = len(media)
                    out.append(entry)
    except (zipfile.BadZipFile, OSError):
        pass
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    deep = "--tief" in sys.argv
    roots = [Path(a).expanduser() for a in args] or default_roots()
    if deep and not args:
        roots = [Path.home()]

    print("WhatsApp-Suche")
    for r in roots:
        print(f"  durchsuche {r}")
    print()

    found: list[dict] = []
    audio: list[Path] = []
    zips: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for f in walk(root):
            suffix = f.suffix.lower()
            if suffix == ".zip":
                zips.append(f)
            elif suffix in AUDIO_EXT:
                audio.append(f)
            elif suffix == ".txt" and looks_like_chat(f):
                try:
                    msgs = parse_export(f)
                except Exception:
                    continue
                if msgs:
                    found.append(summarize(msgs, chat_name_from_path(f), str(f)))

    for z in zips:
        found += scan_zip(z)

    if not found:
        print("Keine Chat-Exporte gefunden.")
        print("Tipp: Ordner direkt angeben, z. B.")
        print("  python3 finde_whatsapp.py ~/Downloads /pfad/zum/handy")
        print("  python3 finde_whatsapp.py --tief")
        return 1

    # Derselbe Chat kann mehrfach auftauchen, etwa als ZIP und daneben entpackt.
    # Fuer den Vorschlag zaehlt nur eine Quelle je Chat, sonst waere der Verlauf doppelt.
    best: dict[tuple, dict] = {}
    duplicates: list[tuple[dict, dict]] = []
    for f in found:
        prev = best.get(f["fingerprint"])
        if prev is None:
            best[f["fingerprint"]] = f
        elif f["media_in_zip"] > prev["media_in_zip"]:
            best[f["fingerprint"]] = f
            duplicates.append((prev, f))
        else:
            duplicates.append((f, prev))
    unique = list(best.values())

    print(f"{len(found)} Chat-Export(e) gefunden, {len(unique)} davon eigenstaendig\n")
    for i, f in enumerate(unique, 1):
        print(f"[{i}] {f['label']}")
        print(f"    Datei:          {f['source']}")
        print(f"    Zeitraum:       {f['von']} bis {f['bis']}")
        print(f"    Nachrichten:    {f['messages']}")
        print(f"    Sprachnachr.:   {f['voice']} (davon {f['named']} mit Dateiname im Export)")
        print(f"    Teilnehmer:     {', '.join(f['teilnehmer']) or '-'}")
        if f["extra"]:
            print(f"    Hinweis:        {f['extra']}")
        print()

    if audio:
        by_dir = Counter(str(p.parent) for p in audio)
        print(f"{len(audio)} Audiodateien gefunden, groesste Ordner:")
        for d, c in by_dir.most_common(5):
            print(f"    {c:>6}  {d}")
        print()

    if duplicates:
        print("Uebersprungen, weil inhaltsgleich mit einem der obigen Funde:")
        for dup, keep in duplicates:
            print(f"    {dup['source']}\n        gleicht {keep['source']}")
        print()

    print("Vorschlag fuer den Lauf (Namen nach Bedarf anpassen):\n")
    parts = ["python3 wa_forensics.py"]
    for f in unique:
        parts.append(f'  "{f["source"]}::{f["label"]}"')
    for d, _ in Counter(str(p.parent) for p in audio).most_common(3):
        parts.append(f'  --media-pool "{d}"')
    parts += ['  --out "./Verlauf"', '  --me "DEIN NAME IM CHAT"',
              "  --asr openai --model whisper-1", "  --dry-run"]
    print(" \\\n".join(parts))
    print("\nZuerst mit --dry-run pruefen, dann ohne --dry-run laufen lassen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
