"""ZIP-Entpacken, Medien-Aufloesung, Opus/MP3-Konvertierung und Archiv-Ablage."""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import shutil
import subprocess
import zipfile
from collections import defaultdict
from pathlib import Path

from .model import Attachment, Message

MEDIA_EXT = {
    ".opus", ".ogg", ".m4a", ".aac", ".mp3", ".wav", ".amr",
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic",
    ".mp4", ".3gp", ".mov", ".mkv", ".pdf", ".docx", ".xlsx", ".vcf",
}
AUDIO_EXT = {".opus", ".ogg", ".m4a", ".aac", ".mp3", ".wav", ".amr"}
MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
             "August", "September", "Oktober", "November", "Dezember"]

# PTT-20260901-WA0001.opus  /  00000042-AUDIO-2026-09-01-23-14-05.opus
DATE_IN_NAME = [
    re.compile(r"(?:PTT|IMG|VID|AUD|DOC)-(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})-", re.I),
    re.compile(r"(?:AUDIO|PHOTO|VIDEO)-(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})", re.I),
    re.compile(r"(?P<y>20\d{2})(?P<m>\d{2})(?P<d>\d{2})"),
]


def safe_name(name: str, fallback: str = "Unbenannt") -> str:
    """Dateisystem-taugliche Variante eines Chat- oder Personennamens."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", (name or "").strip())
    cleaned = re.sub(r"\s+", "_", cleaned).strip("._")
    return cleaned[:80] or fallback


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def extract_zips(zips: list[Path], workdir: Path) -> list[Path]:
    """Entpackt Exporte. Liefert die Zielverzeichnisse."""
    out = []
    for zp in zips:
        target = workdir / safe_name(zp.stem)
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zp) as zf:
            for info in zf.infolist():
                # Zip-Slip-Schutz
                dest = (target / info.filename).resolve()
                if not str(dest).startswith(str(target.resolve())):
                    continue
                zf.extract(info, target)
        out.append(target)
    return out


def find_chat_files(root: Path) -> list[Path]:
    """Findet _chat.txt bzw. 'WhatsApp Chat mit X.txt' unterhalb von root."""
    hits = [p for p in root.rglob("*.txt")
            if p.name == "_chat.txt" or re.match(r"WhatsApp[- ]?Chat", p.name, re.I)]
    return hits or [p for p in root.rglob("*.txt")]


def ffmpeg_exe() -> str:
    """ffmpeg aus PATH, sonst das mit imageio-ffmpeg gelieferte Static-Binary."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def audio_duration(path: Path) -> float | None:
    """Laufzeit in Sekunden. Erst per Container-Header, sonst per ffmpeg."""
    try:
        import mutagen
        f = mutagen.File(str(path))
        if f is not None and getattr(f, "info", None) is not None:
            return float(f.info.length)
    except Exception:
        pass
    try:
        proc = subprocess.run(
            [ffmpeg_exe(), "-hide_banner", "-i", str(path), "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
        m = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", proc.stderr)
        if m:
            h, mi, s = m[-1]
            return int(h) * 3600 + int(mi) * 60 + float(s)
    except Exception:
        pass
    return None


def to_mp3(src: Path, dest: Path, bitrate: str = "64k", mono: bool = True) -> bool:
    """Konvertiert eine Audiodatei nach MP3. Originaldatei bleibt unangetastet."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return True
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
           "-vn", "-c:a", "libmp3lame", "-b:a", bitrate, "-ar", "44100"]
    if mono:
        cmd += ["-ac", "1"]
    cmd.append(str(dest))
    return subprocess.run(cmd, capture_output=True).returncode == 0


class MediaIndex:
    """Index ueber einen (grossen) Medien-Pool zur Aufloesung von Anhaengen."""

    def __init__(self, roots: list[Path]) -> None:
        self.by_name: dict[str, list[Path]] = defaultdict(list)
        self.audio_by_date: dict[dt.date, list[Path]] = defaultdict(list)
        self.total = 0
        for root in roots:
            if not root.exists():
                continue
            for p in root.rglob("*"):
                if not p.is_file() or p.suffix.lower() not in MEDIA_EXT:
                    continue
                self.total += 1
                self.by_name[p.name.lower()].append(p)
                if p.suffix.lower() in AUDIO_EXT:
                    d = self._date_of(p)
                    if d:
                        self.audio_by_date[d].append(p)
        for lst in self.audio_by_date.values():
            lst.sort(key=lambda p: (p.name, p.stat().st_mtime))

    @staticmethod
    def _date_of(path: Path) -> dt.date | None:
        for rx in DATE_IN_NAME:
            m = rx.search(path.name)
            if m:
                try:
                    return dt.date(int(m["y"]), int(m["m"]), int(m["d"]))
                except ValueError:
                    continue
        try:
            return dt.datetime.fromtimestamp(path.stat().st_mtime).date()
        except OSError:
            return None

    def resolve(self, att: Attachment, msg: Message, used: set[Path],
                timestamp_fallback: bool = True) -> str:
        """Ordnet einem Anhang eine Datei zu. Liefert den Match-Modus."""
        if att.filename:
            cands = self.by_name.get(att.filename.lower(), [])
            if cands:
                pick = max(cands, key=lambda p: p.stat().st_size)
                att.resolved_path = str(pick)
                used.add(pick)
                return "exact"
        if timestamp_fallback and att.kind in ("voice", "audio", "unknown"):
            for cand in self.audio_by_date.get(msg.date_key, []):
                if cand in used:
                    continue
                att.resolved_path = str(cand)
                if not att.filename:
                    att.filename = cand.name
                att.kind = "voice"
                used.add(cand)
                return "timestamp"
        return "missing"


def archive_dir(base: Path, chat: str, when: dt.datetime) -> Path:
    """<base>/<Chat>/<YYYY>/<MM_Monat>/<YYYY-MM-DD>/"""
    return (base / safe_name(chat) / f"{when.year:04d}"
            / f"{when.month:02d}_{MONTHS_DE[when.month - 1]}"
            / when.strftime("%Y-%m-%d"))
