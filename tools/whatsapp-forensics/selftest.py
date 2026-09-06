#!/usr/bin/env python3
"""Selbsttest: erzeugt synthetische Exporte und prueft die komplette Pipeline.

Aufruf:  python3 selftest.py
Ohne Netz und ohne API-Schluessel lauffaehig, die Transkription wird dabei
uebersprungen (--asr none) und stattdessen ueber den Cache geprueft.
"""

from __future__ import annotations

import csv
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from wa_forensics.media import ffmpeg_exe                      # noqa: E402
from wa_forensics.parser import parse_export                   # noqa: E402
from wa_forensics.pipeline import Options, run                 # noqa: E402

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(ok), detail))
    print(f"  {'OK  ' if ok else 'FEHL'}  {name}{'  ' + detail if detail else ''}")


def make_opus(path: Path, freq: int, seconds: int) -> None:
    subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration={seconds}", "-c:a", "libopus",
         "-b:a", "24k", str(path)], check=True, capture_output=True)


def build_fixtures(root: Path) -> tuple[list[str], Path]:
    z1, z2, z3, pool = (root / n for n in ("z1", "z2", "z3", "pool"))
    for d in (z1, z2, z3, pool):
        d.mkdir(parents=True)

    (z1 / "_chat.txt").write_text(
        "01.09.26, 21:51 - Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.\n"
        "01.09.26, 21:51 - Eduard Tangel: Hab was gutes für dich 👍\n"
        "01.09.26, 23:14 - Eduard Tangel: PTT-20260901-WA0001.opus (Datei angehängt)\n"
        "02.09.26, 08:03 - Stanislaw Lederhos: Angebot ist raus.\nBitte kurz bestätigen.\n",
        encoding="utf-8")
    make_opus(z1 / "PTT-20260901-WA0001.opus", 440, 7)

    (z2 / "_chat.txt").write_text(
        "[03.09.26, 10:00:12] Daniel Weber: Moin Stani\n"
        "[03.09.26, 10:01:45] Daniel Weber: ‎<angehängt: "
        "00000042-AUDIO-2026-09-03-10-01-45.opus>\n"
        "[03.09.26, 10:05:00] Stanislaw Lederhos: Auftrag steht.\n", encoding="utf-8")
    make_opus(z2 / "00000042-AUDIO-2026-09-03-10-01-45.opus", 610, 12)

    (z3 / "_chat.txt").write_text(
        "9/4/26, 6:22 PM - Daniel Weber: <Medien ausgeschlossen>\n"
        "9/4/26, 6:30 PM - Stanislaw Lederhos: Alles notiert\n", encoding="utf-8")
    make_opus(pool / "PTT-20260904-WA0007.opus", 700, 9)

    zips = []
    for src, label in ((z1, "Eduard Tangel"), (z2, "Daniel Weber"), (z3, "Projektgruppe")):
        zp = root / f"{src.name}.zip"
        with zipfile.ZipFile(zp, "w") as zf:
            for f in src.iterdir():
                zf.write(f, f.name)
        zips.append(f"{zp}::{label}")
    return zips, pool


def main() -> int:
    print("WhatsApp Forensics Toolkit — Selbsttest\n")
    tmp = Path(tempfile.mkdtemp(prefix="wa_selftest_"))
    try:
        zips, pool = build_fixtures(tmp)
        out = tmp / "ausgabe"

        print("Parser")
        with zipfile.ZipFile(zips[0].split("::")[0]) as zf:
            zf.extractall(tmp / "peek")
        msgs = parse_export(tmp / "peek" / "_chat.txt", chat="Eduard Tangel")
        check("Android-Format gelesen", len(msgs) == 4, f"{len(msgs)} Nachrichten")
        check("Systemnachricht erkannt", msgs[0].is_system)
        check("Anhang erkannt", msgs[2].attachments and
              msgs[2].attachments[0].filename == "PTT-20260901-WA0001.opus")
        check("Mehrzeilige Nachricht zusammengehalten", "\n" in msgs[3].text)

        print("\nPipeline")
        stats = run(Options(inputs=zips, out=out, media_pools=[pool],
                            me="Stanislaw Lederhos", asr="none",
                            title="Selbsttest", workers=2))
        check("Alle Chats zusammengefuehrt", stats["messages"] == 9, f"{stats['messages']}")
        check("Sprachnachrichten gefunden", stats["voice"] == 3, f"{stats['voice']}")
        check("Medien archiviert", stats["media"] == 3, f"{stats['media']}")

        print("\nAblage")
        opus = sorted((out / "Medien").rglob("*.opus"))
        mp3 = sorted((out / "Medien").rglob("*.mp3"))
        check("Originale abgelegt", len(opus) == 3, f"{len(opus)} Dateien")
        check("MP3 erzeugt", len(mp3) == 3, f"{len(mp3)} Dateien")
        check("MP3 nicht leer", all(f.stat().st_size > 500 for f in mp3))
        structure = [p.relative_to(out / "Medien").parts for p in opus]
        check("Struktur Chat/Jahr/Monat/Datum", all(len(p) == 5 for p in structure),
              "/".join(structure[0][:4]) if structure else "")

        print("\nManifest und PDF")
        rows = list(csv.DictReader((out / "Manifest.csv").open(encoding="utf-8-sig")))
        voice_rows = [r for r in rows if r["typ"] == "voice"]
        check("Manifest vollstaendig", len(rows) >= 9, f"{len(rows)} Zeilen")
        check("Pruefsummen vorhanden", all(len(r["sha256"]) == 64 for r in voice_rows))
        check("Dauer ermittelt", all(r["dauer"] for r in voice_rows),
              ", ".join(r["dauer"] for r in voice_rows))
        modes = {r["zuordnung"] for r in voice_rows}
        check("Zeitstempel-Zuordnung greift", "timestamp" in modes, str(sorted(modes)))
        blob = json.loads((out / "Verlauf.json").read_text("utf-8"))
        check("JSON lesbar", len(blob["nachrichten"]) == stats["messages"])
        pdf = out / "WhatsApp_Gesamtverlauf.pdf"
        check("PDF erzeugt", pdf.exists() and pdf.stat().st_size > 5000,
              f"{pdf.stat().st_size // 1024} KB" if pdf.exists() else "fehlt")
        head = pdf.read_bytes()[:5]
        check("PDF-Struktur gueltig", head == b"%PDF-")

        print("\nTranskript-Darstellung")
        cache = out / "_cache" / "transkripte.json"
        cache.parent.mkdir(exist_ok=True)
        digests = [r["sha256"] for r in voice_rows]
        cache.write_text(json.dumps(
            {d: {"text": f"Testtranskript {i}", "lang": "de", "engine": "selftest"}
             for i, d in enumerate(digests, 1)}, ensure_ascii=False), "utf-8")
        run(Options(inputs=zips, out=out, media_pools=[pool], me="Stanislaw Lederhos",
                    asr="faster-whisper", title="Selbsttest", workers=2))
        rows2 = list(csv.DictReader((out / "Manifest.csv").open(encoding="utf-8-sig")))
        got = [r["transkript"] for r in rows2 if r["typ"] == "voice"]
        check("Cache wird genutzt", all(t.startswith("Testtranskript") for t in got),
              f"{len(got)} Transkripte")
        try:
            import pymupdf
            text = "".join(p.get_text() for p in pymupdf.open(pdf))
            check("Transkript-Tag im PDF", "[Transkript aus" in text)
            check("Datums-Kopfzeile im PDF", "Nachricht" in text and "01.09.2026" in text)
        except ImportError:
            print("  ---   PDF-Textpruefung uebersprungen (pymupdf nicht installiert)")

        failed = [n for n, ok, _ in CHECKS if not ok]
        print(f"\n{len(CHECKS) - len(failed)} von {len(CHECKS)} Pruefungen bestanden")
        if failed:
            print("Fehlgeschlagen: " + ", ".join(failed))
            return 1
        print("Alles in Ordnung.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
