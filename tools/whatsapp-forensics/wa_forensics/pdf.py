"""PDF-Protokoll: Deckblatt, Datumsgruppen, Nachrichten, Transkripte, Anlagen."""

from __future__ import annotations

import datetime as dt
import html
import unicodedata
from collections import defaultdict
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

from .model import Message

WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

INK = colors.HexColor("#1F2933")
MUTED = colors.HexColor("#6B7280")
ACCENT = colors.HexColor("#B08D3F")       # warmes Gold
BAR_BG = colors.HexColor("#F1EFE9")
RULE = colors.HexColor("#D8D3C7")
ME_COLOR = colors.HexColor("#1D4E89")

FONT_CANDIDATES = [
    ("DejaVuSans", [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/DejaVuSans.ttf",
        "C:/Windows/Fonts/DejaVuSans.ttf",
    ], [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
    ]),
    ("NotoSans", [
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    ], [
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "/usr/share/fonts/noto/NotoSans-Bold.ttf",
    ]),
    ("Liberation", [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ], [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]),
]

# Monochrome Emoji-Schriften. Farb-Emoji (NotoColorEmoji, Segoe UI Emoji,
# Apple Color Emoji) sind Bitmap-Formate und im PDF nicht einbettbar.
EMOJI_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
    "/usr/share/fonts/noto/NotoEmoji-Regular.ttf",
    "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf",
    "/usr/share/fonts/truetype/symbola/Symbola.ttf",
]


def register_fonts() -> tuple[str, str]:
    """Registriert die beste verfuegbare Unicode-Schrift. Liefert (regular, bold)."""
    for family, regs, bolds in FONT_CANDIDATES:
        reg = next((p for p in regs if Path(p).exists()), None)
        if not reg:
            continue
        bold = next((p for p in bolds if Path(p).exists()), reg)
        pdfmetrics.registerFont(TTFont(family, reg))
        pdfmetrics.registerFont(TTFont(family + "-Bold", bold))
        return family, family + "-Bold"
    import reportlab
    base = Path(reportlab.__file__).parent / "fonts"
    pdfmetrics.registerFont(TTFont("Vera", str(base / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("Vera-Bold", str(base / "VeraBd.ttf")))
    return "Vera", "Vera-Bold"


def register_emoji_font(path: str | None) -> str | None:
    """Registriert eine monochrome Emoji-Schrift, falls vorhanden."""
    candidates = ([path] if path else []) + EMOJI_CANDIDATES
    for cand in candidates:
        if cand and Path(cand).exists():
            try:
                pdfmetrics.registerFont(TTFont("EmojiFont", cand))
                return "EmojiFont"
            except Exception:
                continue
    return None


def _glyph_filter(font_name: str, mode: str, emoji_font: str | None):
    """Behandelt Zeichen, die die Hauptschrift nicht kennt (typisch: Emojis)."""
    try:
        supported = set(pdfmetrics.getFont(font_name).face.charToGlyph.keys())
    except Exception:
        supported = None
    emoji_glyphs = None
    if emoji_font:
        try:
            emoji_glyphs = set(pdfmetrics.getFont(emoji_font).face.charToGlyph.keys())
        except Exception:
            emoji_glyphs = None

    def apply(text: str) -> str:
        if mode == "keep" or supported is None:
            return text
        out = []
        for ch in text:
            cp = ord(ch)
            if ch in "\n\t" or cp in supported:
                out.append(ch)
            elif emoji_glyphs is not None and cp in emoji_glyphs:
                out.append(f'<font name="{emoji_font}">{ch}</font>')
            elif mode == "strip":
                continue
            elif mode == "name":
                try:
                    out.append(f"[{unicodedata.name(ch).title()}]")
                except ValueError:
                    out.append(f"[U+{cp:04X}]")
            else:
                out.append(f"[U+{cp:04X}]")
        return "".join(out)

    return apply


def esc(text: str) -> str:
    return html.escape(text, quote=False).replace("\n", "<br/>")


class PageFurniture:
    """Fussleiste mit Dokumentkennung und Seitenzahl."""

    def __init__(self, doc_id: str, created: str, font: str):
        self.doc_id, self.created, self.font = doc_id, created, font

    def __call__(self, canvas, doc):
        canvas.saveState()
        canvas.setFont(self.font, 7.5)
        canvas.setFillColor(MUTED)
        w, _ = A4
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
        canvas.drawString(18 * mm, 10 * mm,
                          f"Dokument {self.doc_id} · erstellt {self.created}")
        canvas.drawRightString(w - 18 * mm, 10 * mm, f"Seite {canvas.getPageNumber()}")
        canvas.restoreState()


def build_pdf(messages: list[Message], out_path: Path, *, title: str,
              chats: list[str], me: str | None = None, doc_id: str = "",
              emoji_mode: str = "placeholder", emoji_font_path: str | None = None,
              include_annex: bool = True, stats: dict | None = None,
              method_notes: list[str] | None = None) -> Path:
    """Erzeugt das Gesamtprotokoll als PDF."""
    regular, bold = register_fonts()
    emoji_font = register_emoji_font(emoji_font_path) if emoji_mode != "strip" else None
    clean = _glyph_filter(regular, emoji_mode, emoji_font)
    created = dt.datetime.now().strftime("%d.%m.%Y %H:%M")

    def rt(text: str) -> str:
        """Text sicher fuer Paragraph aufbereiten."""
        return clean(esc(text))

    ss = getSampleStyleSheet()
    st = {
        "title": ParagraphStyle("t", parent=ss["Title"], fontName=bold, fontSize=19,
                                leading=24, textColor=INK, alignment=TA_LEFT, spaceAfter=2),
        "sub": ParagraphStyle("s", fontName=regular, fontSize=10, leading=14,
                              textColor=MUTED, spaceAfter=10),
        "h2": ParagraphStyle("h2", fontName=bold, fontSize=12, leading=16,
                             textColor=INK, spaceBefore=12, spaceAfter=6),
        "meta": ParagraphStyle("m", fontName=regular, fontSize=9, leading=13, textColor=INK),
        "metab": ParagraphStyle("mb", fontName=bold, fontSize=9, leading=13, textColor=INK),
        "day": ParagraphStyle("d", fontName=bold, fontSize=10.5, leading=14, textColor=INK),
        "daycount": ParagraphStyle("dc", fontName=regular, fontSize=9, leading=14,
                                   textColor=MUTED, alignment=2),
        "head": ParagraphStyle("mh", fontName=bold, fontSize=8.8, leading=12, textColor=INK),
        "body": ParagraphStyle("mt", fontName=regular, fontSize=9.6, leading=13.4,
                               textColor=INK, spaceAfter=5),
        "sys": ParagraphStyle("sy", fontName=regular, fontSize=8.4, leading=11.6,
                              textColor=MUTED, spaceAfter=5),
        "tag": ParagraphStyle("tg", fontName=bold, fontSize=8.2, leading=11,
                              textColor=ACCENT, spaceBefore=1),
        "trans": ParagraphStyle("tr", fontName=regular, fontSize=9.4, leading=13,
                                textColor=INK, leftIndent=8, spaceAfter=5),
        "note": ParagraphStyle("nt", fontName=regular, fontSize=8.2, leading=11.4,
                               textColor=MUTED, spaceAfter=4),
        "annex": ParagraphStyle("an", fontName=regular, fontSize=7.0, leading=9.2, textColor=INK),
    }

    doc = BaseDocTemplate(str(out_path), pagesize=A4,
                          leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=16 * mm, bottomMargin=20 * mm,
                          title=title, author="WhatsApp Forensics Toolkit")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(
        id="all", frames=[frame], onPage=PageFurniture(doc_id or "-", created, regular))])

    flow = []
    # ---------- Deckblatt ----------
    flow.append(Paragraph(rt(title), st["title"]))
    flow.append(Paragraph("Chronologisches Gesamtprotokoll aus WhatsApp-Exporten", st["sub"]))

    s = stats or {}
    audio_min = (s.get("audio_seconds") or 0) / 60
    rows = [
        ("Erfasste Chats", ", ".join(chats)),
        ("Zeitraum", s.get("range", "-")),
        ("Kalendertage", str(s.get("days", "-"))),
        ("Nachrichten gesamt", str(s.get("messages", len(messages)))),
        ("Sprachnachrichten", f"{s.get('voice', 0)}, davon {s.get('transcribed', 0)} transkribiert"),
        ("Audiolaufzeit", f"{audio_min:.0f} Minuten" if audio_min else "-"),
        ("Medien archiviert", str(s.get("media", 0))),
        ("Dokumentkennung", doc_id or "-"),
        ("Erstellt am", created),
    ]
    tbl = Table([[Paragraph(rt(k), st["metab"]), Paragraph(rt(str(v)), st["meta"])]
                 for k, v in rows], colWidths=[42 * mm, doc.width - 42 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
    ]))
    flow += [tbl, Spacer(1, 8 * mm)]

    flow.append(Paragraph("Methodik und Hinweise", st["h2"]))
    for note in (method_notes or []):
        flow.append(Paragraph("• " + rt(note), st["note"]))
    if emoji_mode == "placeholder" and not emoji_font:
        flow.append(Paragraph(
            "• Emojis erscheinen als Unicode-Kennung in eckigen Klammern, etwa [U+1F44D]. "
            "Der Originaltext bleibt dadurch verlustfrei nachvollziehbar.", st["note"]))
    flow.append(PageBreak())

    # ---------- Nachrichten nach Datum ----------
    by_day: dict[dt.date, list[Message]] = defaultdict(list)
    for m in messages:
        by_day[m.date_key].append(m)

    multi_chat = len(set(m.chat for m in messages)) > 1
    for day in sorted(by_day):
        day_msgs = by_day[day]
        label = f"{WEEKDAYS_DE[day.weekday()]}, {day.strftime('%d.%m.%Y')}"
        n = len(day_msgs)
        voice_n = sum(1 for m in day_msgs for a in m.attachments if a.kind in ("voice", "audio"))
        counter = f"{n} Nachricht{'en' if n != 1 else ''}"
        if voice_n:
            counter += f" · {voice_n} Sprachnachricht{'en' if voice_n != 1 else ''}"
        bar = Table([[Paragraph(rt(label), st["day"]), Paragraph(counter, st["daycount"])]],
                    colWidths=[doc.width * 0.55, doc.width * 0.45])
        bar.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BAR_BG),
            ("LINEABOVE", (0, 0), (-1, 0), 1.1, ACCENT),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        flow += [Spacer(1, 3 * mm), bar, Spacer(1, 2.5 * mm)]

        for m in day_msgs:
            block = []
            time_s = m.timestamp.strftime("%H:%M")
            if m.is_system:
                block.append(Paragraph(f"{time_s} · {rt(m.text)}", st["sys"]))
            else:
                who = rt(m.sender or "Unbekannt")
                col = ME_COLOR if (me and m.sender == me) else INK
                badge = ""
                if multi_chat and m.chat != m.sender:
                    badge = f' <font color="#6B7280">· {rt(m.chat)}</font>'
                block.append(Paragraph(
                    f'<font color="#6B7280">{time_s}</font> '
                    f'<font color="#{col.hexval()[2:]}"><b>{who}</b></font>{badge}',
                    st["head"]))
                if m.text:
                    block.append(Paragraph(rt(m.text), st["body"]))
            for a in m.attachments:
                if a.transcript:
                    block.append(Paragraph(
                        rt(f"[Transkript aus {a.filename}, {a.duration_hms}]"), st["tag"]))
                    block.append(Paragraph(rt(a.transcript), st["trans"]))
                elif a.kind in ("voice", "audio"):
                    reason = {"missing": "Datei im Medienbestand nicht gefunden",
                              "omitted": "im Export ohne Datei"}.get(
                        a.match_mode or "", "ohne Transkript")
                    name = a.filename or "unbenannte Sprachnachricht"
                    block.append(Paragraph(
                        rt(f"[Sprachnachricht {name} · {reason}]"), st["note"]))
                elif a.filename:
                    block.append(Paragraph(rt(f"[Anhang {a.filename} · {a.kind}]"), st["note"]))
            flow.append(KeepTogether(block))

    # ---------- Anlage: Medienverzeichnis ----------
    if include_annex:
        annex = [(m, a) for m in messages for a in m.attachments if a.sha256]
        if annex:
            flow.append(PageBreak())
            flow.append(Paragraph("Anlage: Medienverzeichnis mit Prüfsummen", st["h2"]))
            flow.append(Paragraph(
                "SHA-256 der unveränderten Originaldateien. Die MP3-Fassungen sind reine "
                "Formatwandlungen zum Abhören, maßgeblich ist stets das Original. Die Spalte "
                "Zuordnung zeigt, ob der Dateiname direkt aus dem Chat stammt (exakt) oder "
                "über den Zeitstempel ermittelt wurde (Zeitstempel).", st["note"]))
            head = ["Datum", "Zeit", "Chat", "Datei", "Dauer", "Zuordnung", "SHA-256"]
            data = [[Paragraph(f"<b>{h}</b>", st["annex"]) for h in head]]
            label = {"exact": "exakt", "timestamp": "Zeitstempel", "missing": "fehlend"}
            for m, a in annex:
                data.append([
                    Paragraph(m.timestamp.strftime("%d.%m.%Y"), st["annex"]),
                    Paragraph(m.timestamp.strftime("%H:%M"), st["annex"]),
                    Paragraph(rt(m.chat), st["annex"]),
                    Paragraph(rt(a.filename), st["annex"]),
                    Paragraph(a.duration_hms, st["annex"]),
                    Paragraph(label.get(a.match_mode or "", "-"), st["annex"]),
                    Paragraph(a.sha256 or "-", st["annex"]),
                ])
            widths = [19 * mm, 11 * mm, 24 * mm, 40 * mm, 12 * mm, 19 * mm]
            widths.append(doc.width - sum(widths))
            at = Table(data, colWidths=widths, repeatRows=1)
            at.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), BAR_BG),
                ("GRID", (0, 0), (-1, -1), 0.25, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]))
            flow.append(at)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.build(flow)
    return out_path
