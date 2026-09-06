"""Parser fuer WhatsApp-Chat-Exporte (Android + iOS, DE/EN, 12h/24h)."""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter
from pathlib import Path

from .model import Attachment, Message

# Unsichtbare Steuerzeichen, die WhatsApp-Exporte durchsetzen.
INVISIBLE = dict.fromkeys(map(ord, "‎‏‪‫‬⁦⁧⁨⁩﻿"), None)

# [01.09.26, 23:14:05] Name: Text      (iOS)
IOS_RE = re.compile(
    r"^\[(?P<date>\d{1,4}[./-]\d{1,2}[./-]\d{2,4}),?\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ampm>[AaPp]\.?\s?[Mm]\.?)?\]\s*(?P<rest>.*)$"
)
# 01.09.26, 23:14 - Name: Text         (Android)
ANDROID_RE = re.compile(
    r"^(?P<date>\d{1,4}[./-]\d{1,2}[./-]\d{2,4}),?\s+"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ampm>[AaPp]\.?\s?[Mm]\.?)?\s+-\s+(?P<rest>.*)$"
)

# Anhaenge
ATTACH_ANDROID = re.compile(r"^(?P<name>[^\s<>][^<>]*?)\s*\((?:Datei angeh(?:ä|ae)ngt|file attached)\)\s*$", re.I)
ATTACH_IOS = re.compile(r"<(?:angeh(?:ä|ae)ngt|attached|adjunto|allegato)\s*:\s*(?P<name>[^>]+)>", re.I)
OMITTED_RE = re.compile(
    r"<(?:Medien ausgeschlossen|Media omitted|Bild weggelassen|image omitted|video omitted|"
    r"audio omitted|Audio weggelassen|Sprachnachricht weggelassen|GIF omitted|sticker omitted|"
    r"Sticker weggelassen|document omitted|Dokument weggelassen)>"
    r"|(?:^|\s)(?:audio omitted|Audio weggelassen|Sprachnachricht weggelassen|Medien ausgeschlossen|Media omitted)(?:\s|$)",
    re.I,
)
OMITTED_VOICE_RE = re.compile(r"audio omitted|Audio weggelassen|Sprachnachricht weggelassen|voice message", re.I)

AUDIO_EXT = {".opus", ".ogg", ".m4a", ".aac", ".mp3", ".wav", ".amr", ".mp4a"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}
VIDEO_EXT = {".mp4", ".3gp", ".mov", ".mkv", ".avi"}

# Systemnachrichten ohne Absender
SYSTEM_MARKERS = (
    "Ende-zu-Ende-verschlüsselt", "end-to-end encrypted", "Sicherheitsnummer",
    "security code", "hat die Gruppe", "created group", "hat dich hinzugefügt",
    "added you", "Nachrichten und Anrufe", "Messages and calls",
    "verpasster Sprachanruf", "Missed voice call", "hat den Gruppennamen",
)


def _classify(name: str) -> str:
    ext = Path(name).suffix.lower()
    stem = Path(name).stem.upper()
    if ext in AUDIO_EXT:
        # PTT = Push To Talk = Sprachnachricht. AUDIO-  = iOS-Sprachnachricht.
        if stem.startswith("PTT") or "-AUDIO-" in stem or ext == ".opus":
            return "voice"
        return "audio"
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    return "document"


def _parse_date(datestr: str, dayfirst: bool) -> tuple[int, int, int]:
    parts = re.split(r"[./-]", datestr)
    a, b, c = (int(p) for p in parts)
    if len(parts[0]) == 4:                       # 2026-09-01
        return a, b, c
    year = c + (2000 if c < 100 else 0)
    return (year, b, a) if dayfirst else (year, a, b)


def _detect_dayfirst(raw_dates: list[str]) -> bool:
    """Loest 01/09 vs 09/01 anhand des gesamten Exports auf."""
    if not raw_dates:
        return True
    if any("." in d for d in raw_dates):          # Punktformat ist immer TT.MM.
        return True
    first, second = [], []
    for d in raw_dates:
        p = re.split(r"[./-]", d)
        if len(p[0]) == 4:
            continue
        first.append(int(p[0]))
        second.append(int(p[1]))
    if any(v > 12 for v in first):
        return True
    if any(v > 12 for v in second):
        return False
    return False                                  # Slash ohne Hinweis: US-Format


def _make_dt(datestr: str, timestr: str, ampm: str | None, dayfirst: bool) -> dt.datetime:
    y, mo, d = _parse_date(datestr, dayfirst)
    tp = [int(x) for x in timestr.split(":")]
    hh, mm = tp[0], tp[1]
    ss = tp[2] if len(tp) > 2 else 0
    if ampm:
        marker = ampm.replace(".", "").replace(" ", "").lower()
        if marker.startswith("p") and hh != 12:
            hh += 12
        elif marker.startswith("a") and hh == 12:
            hh = 0
    return dt.datetime(y, mo, d, hh, mm, ss)


def _split_sender(rest: str) -> tuple[str, str, bool]:
    """Trennt 'Name: Text'. Gibt (sender, text, is_system) zurueck."""
    if ": " in rest:
        head, tail = rest.split(": ", 1)
        if len(head) <= 80 and "\n" not in head:
            return head.strip(), tail, False
    for marker in SYSTEM_MARKERS:
        if marker.lower() in rest.lower():
            return "", rest.strip(), True
    return "", rest.strip(), True


def _extract_attachments(text: str) -> tuple[str, list[Attachment]]:
    """Zieht Anhaenge aus dem Nachrichtentext und liefert bereinigten Text."""
    atts: list[Attachment] = []
    lines_out = []
    for line in text.split("\n"):
        stripped = line.strip()
        m = ATTACH_ANDROID.match(stripped)
        if m:
            name = m.group("name").strip()
            atts.append(Attachment(filename=name, kind=_classify(name)))
            continue
        found_ios = False
        for m in ATTACH_IOS.finditer(stripped):
            name = m.group("name").strip()
            atts.append(Attachment(filename=name, kind=_classify(name)))
            found_ios = True
        if found_ios:
            stripped = ATTACH_IOS.sub("", stripped).strip()
            if stripped:
                lines_out.append(stripped)
            continue
        if OMITTED_RE.search(stripped):
            kind = "voice" if OMITTED_VOICE_RE.search(stripped) else "unknown"
            atts.append(Attachment(filename="", kind=kind, match_mode="omitted"))
            rest = OMITTED_RE.sub("", stripped).strip()
            if rest:
                lines_out.append(rest)
            continue
        lines_out.append(line)
    return "\n".join(lines_out).strip(), atts


def chat_name_from_path(path: Path) -> str:
    """Leitet den Chat-Namen aus dem Dateinamen ab."""
    stem = path.stem
    for pat in (
        r"^WhatsApp[- ]?Chat (?:mit|with|con|avec)\s+(.+)$",
        r"^WhatsApp[- ]?Chat\s*[-–]\s*(.+)$",
        r"^Chat (?:mit|with)\s+(.+)$",
        r"^WhatsApp[- ]?Chat$",
    ):
        m = re.match(pat, stem, re.I)
        if m:
            return m.group(1).strip() if m.groups() else stem
    if stem == "_chat":
        parent = path.parent.name
        return re.sub(r"^WhatsApp[- ]?Chat (?:mit|with)\s+", "", parent, flags=re.I) or "Chat"
    return stem


def parse_export(path: Path, chat: str | None = None) -> list[Message]:
    """Parst eine _chat.txt und liefert die Nachrichten in Dateireihenfolge."""
    raw = path.read_bytes().decode("utf-8", errors="replace")
    lines = raw.translate(INVISIBLE).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    chat = chat or chat_name_from_path(path)

    # 1. Durchlauf: Datumsformat bestimmen
    raw_dates = []
    for line in lines:
        m = IOS_RE.match(line) or ANDROID_RE.match(line)
        if m:
            raw_dates.append(m.group("date"))
    dayfirst = _detect_dayfirst(raw_dates)

    # 2. Durchlauf: Nachrichten aufbauen (mit Fortsetzungszeilen)
    messages: list[Message] = []
    buf: list[str] = []
    cur: Message | None = None

    def flush() -> None:
        if cur is None:
            return
        text, atts = _extract_attachments("\n".join(buf))
        cur.text = text
        cur.attachments = atts
        messages.append(cur)

    for idx, line in enumerate(lines, start=1):
        m = IOS_RE.match(line) or ANDROID_RE.match(line)
        if m:
            flush()
            try:
                ts = _make_dt(m.group("date"), m.group("time"), m.group("ampm"), dayfirst)
            except ValueError:
                cur = None
                buf = []
                continue
            sender, first_text, is_sys = _split_sender(m.group("rest"))
            cur = Message(timestamp=ts, sender=sender, text="", chat=chat,
                          source_file=str(path), line_no=idx, is_system=is_sys)
            buf = [first_text]
        elif cur is not None:
            buf.append(line)
    flush()
    return messages


def sender_stats(messages: list[Message]) -> Counter:
    return Counter(m.sender for m in messages if m.sender)
