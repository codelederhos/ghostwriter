#!/usr/bin/env python3
"""WhatsApp Forensics Toolkit.

Fuehrt mehrere WhatsApp-Chat-Exporte zu einem chronologischen PDF-Protokoll
zusammen, transkribiert die Sprachnachrichten und legt Originale plus
MP3-Fassungen in einer Datumsstruktur ab.

Beispiel:
    python3 wa_forensics.py \\
        "export_daniel.zip::Daniel" \\
        "export_eduard.zip::Eduard" \\
        "export_gruppe.zip::Projektgruppe" \\
        --media-pool ~/WhatsApp/Media \\
        --out ./Verlauf \\
        --me "Stanislaw Lederhos"
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wa_forensics import __version__
from wa_forensics.pipeline import Options, run


def parse_date(value: str) -> dt.date:
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y"):
        try:
            return dt.datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise argparse.ArgumentTypeError(f"Datum nicht lesbar: {value}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="wa_forensics",
        description="WhatsApp-Exporte zu einem PDF-Gesamtprotokoll mit Transkripten verbinden.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Beispiel:")[-1],
    )
    ap.add_argument("inputs", nargs="+", metavar="EINGABE",
                    help="ZIP, Ordner oder _chat.txt. Optional mit '::Chatname' als Label.")
    ap.add_argument("-o", "--out", default="./wa_verlauf", help="Ausgabeordner")
    ap.add_argument("--media-pool", action="append", default=[], type=Path,
                    help="Zusaetzlicher Medienordner, mehrfach nutzbar (z. B. das 1,3-GB-Backup)")
    ap.add_argument("--me", help="Eigener Anzeigename, wird im PDF farblich abgesetzt")
    ap.add_argument("--title", default="WhatsApp Chatverlauf", help="Titel auf dem Deckblatt")
    ap.add_argument("--pdf-name", default="WhatsApp_Gesamtverlauf.pdf")

    g = ap.add_argument_group("Transkription")
    g.add_argument("--asr", choices=["auto", "openai", "faster-whisper", "none"],
                   default="auto",
                   help="auto nimmt die API wenn OPENAI_API_KEY gesetzt ist, sonst lokal")
    g.add_argument("--model", default="whisper-1",
                   help="API: whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe. "
                        "Lokal: tiny/base/small/medium/large-v3")
    g.add_argument("--asr-prompt",
                   help="Kontextwoerter fuer bessere Erkennung, z. B. Namen und Firmen "
                        "('Lederhos, Tangel, Werbetechnik, Angebot')")
    g.add_argument("--lang", default="de", help="Sprache, 'auto' fuer Erkennung")
    g.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])

    m = ap.add_argument_group("Medien")
    m.add_argument("--mp3-bitrate", default="64k")
    m.add_argument("--no-timestamp-match", action="store_true",
                   help="Keine heuristische Zuordnung ueber Zeitstempel bei <Medien ausgeschlossen>")
    m.add_argument("--workers", type=int, default=4)

    p = ap.add_argument_group("PDF")
    p.add_argument("--emoji", choices=["placeholder", "name", "strip", "keep"],
                   default="placeholder",
                   help="Umgang mit Zeichen, die die Schrift nicht kennt")
    p.add_argument("--emoji-font", help="Pfad zu einer monochromen Emoji-TTF "
                                        "(Farb-Emoji-Fonts kann PDF nicht einbetten)")
    p.add_argument("--no-annex", action="store_true", help="Medienverzeichnis im PDF weglassen")

    f = ap.add_argument_group("Filter")
    f.add_argument("--since", type=parse_date, help="Nur ab diesem Datum")
    f.add_argument("--until", type=parse_date, help="Nur bis zu diesem Datum")
    f.add_argument("--limit", type=int, default=0, help="Nur die ersten N Nachrichten (Test)")

    ap.add_argument("--dry-run", action="store_true",
                    help="Nur analysieren: Anzahl, Zeitraum, gefundene Sprachnachrichten")
    ap.add_argument("--version", action="version", version=f"wa_forensics {__version__}")

    args = ap.parse_args(argv)
    opts = Options(
        inputs=args.inputs, out=Path(args.out), media_pools=list(args.media_pool),
        me=args.me, asr=args.asr, model=args.model,
        language=None if args.lang == "auto" else args.lang, device=args.device,
        mp3_bitrate=args.mp3_bitrate, emoji=args.emoji, emoji_font=args.emoji_font,
        asr_prompt=args.asr_prompt, pdf_name=args.pdf_name,
        title=args.title, since=args.since, until=args.until,
        timestamp_match=not args.no_timestamp_match, annex=not args.no_annex,
        dry_run=args.dry_run, limit=args.limit, workers=max(1, args.workers),
    )
    run(opts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
