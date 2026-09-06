# WhatsApp Forensics Toolkit

Verbindet mehrere WhatsApp-Chat-Exporte zu **einem chronologischen PDF-Protokoll**,
transkribiert die Sprachnachrichten und legt Originale plus MP3-Fassungen in einer
Datumsstruktur ab. Gebaut für den Fall, dass ein vollständiger Auftrags- oder
Kundenverlauf über mehrere Chats hinweg belegt werden muss.

## Was das Tool macht

1. **ZIP entpacken** und alle Chat-Exporte einlesen (Android und iOS, DE/EN, 12h/24h)
2. **Chats zusammenführen** und global nach Zeitstempel sortieren
3. **Sprachnachrichten ermitteln**, die in genau diesen Chats vorkommen, über den
   Dateinamen aus dem Export oder über Datum und Zeitstempel
4. **Opus nach MP3 wandeln**, das Original bleibt unverändert daneben liegen
5. **Transkribieren** über die OpenAI-API oder lokal mit faster-whisper
6. **PDF erzeugen**: Datumsgruppen mit Kopfzeile und Anzahl, Uhrzeit, Name,
   Transkripte mit Tag `[Transkript aus <Datei>, <Dauer>]`
7. **Manifest schreiben**: CSV und JSON mit SHA-256 jeder Originaldatei

## Ausgabe

```
Ausgabeordner/
├── WhatsApp_Gesamtverlauf.pdf     Deckblatt, Verlauf, Anlage mit Prüfsummen
├── Manifest.csv                   eine Zeile je Nachricht und Anhang
├── Verlauf.json                   vollständige Struktur, maschinenlesbar
├── Medien/
│   └── Eduard_Tangel/2026/09_September/2026-09-01/
│       ├── 2026-09-01_23-14_Eduard_Tangel_PTT-20260901-WA0001.opus   Original
│       └── 2026-09-01_23-14_Eduard_Tangel_PTT-20260901-WA0001.mp3    Umwandlung
└── _cache/transkripte.json        Transkript-Cache, macht Abbrüche unkritisch
```

## Installation

```bash
pip install -r requirements.txt      # ffmpeg kommt als Binary mit, keine Systeminstallation nötig
pip install openai                   # nur für den API-Weg
```

Für die API zusätzlich den Schlüssel setzen:

```bash
export OPENAI_API_KEY="sk-..."          # Windows PowerShell: $env:OPENAI_API_KEY="sk-..."
```

## Chats aus WhatsApp exportieren

Chat öffnen, Menü, *Mehr*, *Chat exportieren*, **Medien einschließen**.
WhatsApp deckelt den Medienexport. Wenn Sprachnachrichten fehlen, zusätzlich den
Medienordner des Telefons oder ein Backup als `--media-pool` angeben. Das Tool
zieht sich daraus genau die Dateien, die in den Chats referenziert sind. Der Rest
des Bestands bleibt unangetastet und wird nicht transkribiert.

## Nutzung

Erst ein Probelauf, der nichts schreibt und die Kosten schätzt:

```bash
python3 wa_forensics.py \
  "export_daniel.zip::Daniel" \
  "export_eduard.zip::Eduard" \
  "export_gruppe.zip::Projektgruppe" \
  --media-pool ~/WhatsApp/Media \
  --out ./Verlauf \
  --me "Stanislaw Lederhos" \
  --dry-run
```

Dann der echte Lauf:

```bash
python3 wa_forensics.py \
  "export_daniel.zip::Daniel" \
  "export_eduard.zip::Eduard" \
  "export_gruppe.zip::Projektgruppe" \
  --media-pool ~/WhatsApp/Media \
  --out ./Verlauf \
  --me "Stanislaw Lederhos" \
  --title "Chatverlauf Auftrag Musterprojekt" \
  --asr openai --model whisper-1 \
  --asr-prompt "Lederhos, Tangel, Werbetechnik, Angebot, Rechnung"
```

`::Name` hinter der Eingabe setzt das Chat-Label im PDF. Ohne Angabe wird der
Name aus dem Dateinamen abgeleitet.

## Transkription

| Backend | Aufruf | Eigenschaft |
|---|---|---|
| OpenAI-API | `--asr openai --model whisper-1` | schnell, Hardware egal, Audio geht an OpenAI |
| Lokal | `--asr faster-whisper --model large-v3` | Audio bleibt auf dem Gerät, braucht CPU-Zeit |
| Automatisch | `--asr auto` (Standard) | API wenn `OPENAI_API_KEY` gesetzt ist, sonst lokal |

Richtwert API: rund 0,006 USD je Audiominute mit `whisper-1`, also etwa 0,36 USD
je Stunde Sprachnachrichten. `--dry-run` nennt die Schätzung vorab.

`--asr-prompt` mit Namen und Fachbegriffen füttern, das verbessert die Schreibweise
von Eigennamen deutlich.

Der Cache in `_cache/transkripte.json` ist nach dem SHA-256 der Audiodatei
geschlüsselt. Ein abgebrochener Lauf kann jederzeit wiederholt werden, bereits
transkribierte Dateien werden übersprungen und nicht erneut abgerechnet.

## Wichtige Optionen

| Option | Wirkung |
|---|---|
| `--dry-run` | Analyse ohne Schreibzugriff, mit Kostenschätzung |
| `--me "Name"` | Eigene Nachrichten farblich absetzen, Richtung im Manifest |
| `--since` / `--until` | Zeitraum eingrenzen, z. B. `--since 01.01.2024` |
| `--media-pool` | Zusätzlicher Medienordner, mehrfach nutzbar |
| `--no-timestamp-match` | Nur exakte Dateinamen zuordnen, keine Heuristik |
| `--mp3-bitrate 96k` | Qualität der MP3-Fassung |
| `--emoji name` | Emojis als Klartextname statt Unicode-Kennung |
| `--emoji-font PFAD` | Monochrome Emoji-TTF einbetten, dann echte Symbole im PDF |
| `--no-annex` | Medienverzeichnis im PDF weglassen |
| `--limit 200` | Nur die ersten N Nachrichten, gut zum Ausprobieren |

## Nachvollziehbarkeit

Das PDF ist als Beleg gedacht, deshalb macht es seine Herkunft transparent:

- **SHA-256** jeder archivierten Originaldatei steht in der Anlage und im Manifest
- **Dokumentkennung** in der Fußzeile ist der SHA-256 über alle Nachrichten und
  Mediensummen, gleicher Input ergibt dieselbe Kennung
- **Zuordnung** je Medium ist ausgewiesen: `exakt` aus dem Dateinamen im Export,
  `Zeitstempel` heuristisch ermittelt, `fehlend` nicht auffindbar
- **Originale bleiben unverändert**, MP3 ist als reine Formatwandlung gekennzeichnet
- **Transkripte sind als maschinell erzeugt markiert**, inklusive Engine und Modell

Nicht auffindbare Sprachnachrichten werden im PDF ausgewiesen statt verschwiegen.

## Selbsttest

```bash
python3 selftest.py
```

Erzeugt synthetische Exporte in allen unterstützten Formaten, fährt die komplette
Pipeline und prüft Parser, Medienzuordnung, MP3-Wandlung, Ordnerstruktur, Manifest
und PDF.

## Grenzen

- Transkripte können Hörfehler enthalten, maßgeblich ist immer die Originaldatei
- Farb-Emoji-Schriften lassen sich nicht ins PDF einbetten, deshalb der Platzhalter
- Die Zeitstempel-Heuristik greift nur, wenn Datum und Reihenfolge zusammenpassen
- Zeitangaben stammen aus dem Export und folgen der Zeitzone des Exportgeräts
