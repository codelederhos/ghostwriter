"""Transkription von Sprachnachrichten mit lokalem oder API-Backend.

Backends:
  openai          OpenAI-Audio-API, braucht OPENAI_API_KEY (schnell, laeuft
                  auch auf schwacher Hardware, Audio verlaesst den Rechner)
  faster-whisper  laeuft komplett lokal, Audio bleibt auf dem Geraet

Alle Ergebnisse landen im Cache (Schluessel = SHA-256 des Audios), damit ein
Abbruch jederzeit fortgesetzt werden kann und nichts doppelt bezahlt wird.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

# Grenze der OpenAI-Audio-API. Groessere Dateien werden vorher zerlegt.
API_SIZE_LIMIT = 24 * 1024 * 1024
CHUNK_SECONDS = 900          # 15 Minuten pro Teilstueck
RETRY_DELAYS = (2, 5, 12, 30)

# Grobe Richtwerte in USD je Audiominute. Nur zur Vorabschaetzung.
PRICE_PER_MINUTE = {
    "whisper-1": 0.006,
    "gpt-4o-transcribe": 0.006,
    "gpt-4o-mini-transcribe": 0.003,
}


class TranscriptCache:
    """Persistenter Cache: sha256 -> {text, lang, engine}."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.data: dict[str, dict] = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text("utf-8"))
            except json.JSONDecodeError:
                self.data = {}
        self._dirty = False

    def get(self, digest: str) -> dict | None:
        return self.data.get(digest)

    def put(self, digest: str, payload: dict) -> None:
        self.data[digest] = payload
        self._dirty = True

    def save(self) -> None:
        if not self._dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), "utf-8")
        tmp.replace(self.path)
        self._dirty = False


def estimate_cost(seconds: float, model: str) -> float | None:
    """Grobe Kostenschaetzung in USD, None bei unbekanntem Modell."""
    rate = PRICE_PER_MINUTE.get(model)
    return None if rate is None else (seconds / 60.0) * rate


class Transcriber:
    """Gemeinsame Schnittstelle fuer beide Backends."""

    def __init__(self, backend: str = "faster-whisper", model: str = "large-v3",
                 language: str | None = "de", device: str = "auto",
                 compute_type: str | None = None, prompt: str | None = None) -> None:
        self.backend = backend
        self.model_name = model
        self.language = language
        self.device = device
        self.compute_type = compute_type
        self.prompt = prompt
        self._model = None
        self._client = None

    @property
    def engine_id(self) -> str:
        return f"{self.backend}:{self.model_name}"

    # ---------------- lokal ----------------

    def _load_local(self):
        if self._model is None:
            from faster_whisper import WhisperModel
            device = self.device
            if device == "auto":
                try:
                    import ctranslate2
                    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
                except Exception:
                    device = "cpu"
            compute = self.compute_type or ("float16" if device == "cuda" else "int8")
            self._model = WhisperModel(self.model_name, device=device, compute_type=compute)
        return self._model

    def _local(self, path: Path) -> dict:
        model = self._load_local()
        segments, info = model.transcribe(
            str(path), language=self.language, vad_filter=True, beam_size=5,
            condition_on_previous_text=False, initial_prompt=self.prompt,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "lang": info.language, "engine": self.engine_id}

    # ---------------- API ----------------

    def _load_api(self):
        if self._client is None:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise RuntimeError("Paket 'openai' fehlt. Installation: pip install openai") from exc
            if not os.environ.get("OPENAI_API_KEY"):
                raise RuntimeError("OPENAI_API_KEY ist nicht gesetzt")
            self._client = OpenAI(timeout=180.0, max_retries=0)
        return self._client

    def _api_once(self, path: Path) -> str:
        client = self._load_api()
        last: Exception | None = None
        for attempt, delay in enumerate((0,) + RETRY_DELAYS):
            if delay:
                time.sleep(delay)
            try:
                with path.open("rb") as fh:
                    kwargs = {"model": self.model_name, "file": fh}
                    if self.language:
                        kwargs["language"] = self.language
                    if self.prompt:
                        kwargs["prompt"] = self.prompt
                    return (client.audio.transcriptions.create(**kwargs).text or "").strip()
            except Exception as exc:                    # Rate-Limit, Timeout, 5xx
                last = exc
                name = type(exc).__name__
                if name in ("BadRequestError", "AuthenticationError", "PermissionDeniedError"):
                    raise
        raise RuntimeError(f"API nach {len(RETRY_DELAYS) + 1} Versuchen fehlgeschlagen: {last}")

    def _split(self, path: Path, workdir: Path) -> list[Path]:
        """Zerlegt zu grosse Dateien in Teilstuecke."""
        from .media import ffmpeg_exe
        pattern = str(workdir / "teil_%03d.mp3")
        subprocess.run(
            [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
             "-f", "segment", "-segment_time", str(CHUNK_SECONDS),
             "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1", pattern],
            check=True, capture_output=True,
        )
        return sorted(workdir.glob("teil_*.mp3"))

    def _api(self, path: Path) -> dict:
        if path.stat().st_size <= API_SIZE_LIMIT:
            text = self._api_once(path)
        else:
            with tempfile.TemporaryDirectory() as tmp:
                parts = self._split(path, Path(tmp))
                text = " ".join(self._api_once(p) for p in parts).strip()
        return {"text": text, "lang": self.language or "?", "engine": self.engine_id}

    # ---------------- Fassade ----------------

    def transcribe(self, path: Path) -> dict:
        """Liefert {'text': str, 'lang': str, 'engine': str}."""
        if self.backend == "faster-whisper":
            return self._local(path)
        if self.backend == "openai":
            return self._api(path)
        raise ValueError(f"Unbekanntes Backend: {self.backend}")
