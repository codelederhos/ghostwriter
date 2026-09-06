"""Datenmodell fuer Nachrichten und Medien."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Attachment:
    """Ein im Chat referenziertes Medium."""

    filename: str
    kind: str = "other"          # voice | audio | image | video | document | other
    resolved_path: Optional[str] = None
    sha256: Optional[str] = None
    duration_s: Optional[float] = None
    mp3_path: Optional[str] = None
    archive_path: Optional[str] = None
    transcript: Optional[str] = None
    transcript_lang: Optional[str] = None
    transcript_engine: Optional[str] = None
    match_mode: Optional[str] = None   # exact | timestamp | missing

    @property
    def duration_hms(self) -> str:
        if self.duration_s is None:
            return "?"
        total = int(round(self.duration_s))
        m, s = divmod(total, 60)
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


@dataclass
class Message:
    """Eine einzelne Chat-Nachricht."""

    timestamp: dt.datetime
    sender: str
    text: str
    chat: str
    source_file: str = ""
    line_no: int = 0
    is_system: bool = False
    attachments: list[Attachment] = field(default_factory=list)

    @property
    def date_key(self) -> dt.date:
        return self.timestamp.date()

    @property
    def has_voice(self) -> bool:
        return any(a.kind == "voice" for a in self.attachments)
