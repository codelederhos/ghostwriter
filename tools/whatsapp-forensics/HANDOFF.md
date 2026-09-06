# Übergabe an den lokalen Agenten

Diese Datei ist die Arbeitsanweisung für einen Claude-Agenten, der **lokal auf
Stanis Rechner** läuft und Zugriff auf die Dateien hat. Das Tool selbst wurde in
einer Cloud-Session gebaut, dort gibt es weder den Downloads-Ordner noch das
angeschlossene Handy.

## Auftrag

Aus mehreren WhatsApp-Chatverläufen (Daniel, Eduard, Gruppe) einen vollständigen,
belegfähigen Gesamtverlauf erzeugen. Hintergrund ist ein Streit um eine Rechnung,
bei dem bestritten wird, dass es einen Auftrag gab. Der Verlauf soll die
Auftragsanbahnung lückenlos zeigen, inklusive transkribierter Sprachnachrichten.

## Wo das Tool liegt

```
Repository: codelederhos/ghostwriter
Branch:     claude/whatsapp-chat-pdf-transcripts-vwfrhp
Pfad:       tools/whatsapp-forensics/
```

Holen:

```bash
cd /pfad/zum/ghostwriter
git fetch origin claude/whatsapp-chat-pdf-transcripts-vwfrhp
git checkout claude/whatsapp-chat-pdf-transcripts-vwfrhp
cd tools/whatsapp-forensics
```

Dateien im Ordner:

| Datei | Zweck |
|---|---|
| `wa_forensics.py` | Hauptprogramm, CLI |
| `finde_whatsapp.py` | Sucht Exporte und Sprachnachrichten auf dem Rechner |
| `selftest.py` | Prüft die Installation end-to-end, 21 Prüfungen |
| `README.md` | Vollständige Doku aller Optionen |
| `wa_forensics/` | Module: Parser, Medien, Transkription, PDF, Pipeline |

## Schritt 1: Installation prüfen

```bash
pip install -r requirements.txt
pip install openai            # für den API-Weg
python3 selftest.py           # muss "21 von 21 Prüfungen bestanden" melden
```

`ffmpeg` wird als Binary mitgeliefert (`imageio-ffmpeg`), eine Systeminstallation
ist nicht nötig.

## Schritt 2: Dateien finden

```bash
python3 finde_whatsapp.py
```

Das Skript durchsucht Downloads, Desktop, Dokumente und angeschlossene Laufwerke,
erkennt Chat-Exporte in ZIPs und als lose `.txt`, zählt Nachrichten und
Sprachnachrichten, erkennt Doubletten und schlägt am Ende den fertigen Aufruf vor.

Falls nichts gefunden wird, Ordner direkt angeben:

```bash
python3 finde_whatsapp.py ~/Downloads /pfad/zum/handy
python3 finde_whatsapp.py --tief          # ganzes Benutzerverzeichnis
```

**Handy per USB:** Android-Geräte hängen meist per MTP am System, dort ist der
Zugriff langsam und unvollständig. Erst auf die Festplatte kopieren, dann
verarbeiten. Die Sprachnachrichten liegen typischerweise unter
`WhatsApp/Media/WhatsApp Voice Notes/` und heißen `PTT-JJJJMMTT-WAxxxx.opus`.

## Schritt 3: Probelauf

```bash
export OPENAI_API_KEY="sk-..."          # PowerShell: $env:OPENAI_API_KEY="sk-..."

python3 wa_forensics.py \
  "/pfad/export_daniel.zip::Daniel" \
  "/pfad/export_eduard.zip::Eduard" \
  "/pfad/export_gruppe.zip::Projektgruppe" \
  --media-pool "/pfad/zu/den/sprachnachrichten" \
  --out "./Verlauf" \
  --me "Stanislaw Lederhos" \
  --asr openai --model whisper-1 \
  --dry-run
```

Der Probelauf schreibt nichts. Er zeigt Zeitraum, Nachrichten je Chat, gefundene
und fehlende Sprachnachrichten, Audiolaufzeit und die geschätzten API-Kosten.

**Vor dem echten Lauf prüfen:**
- Stimmen die Chat-Namen hinter `::`? Sie erscheinen so im PDF.
- Ist `--me` exakt der Anzeigename, unter dem Stani in den Chats auftaucht?
- Wie viele Sprachnachrichten sind "nicht auffindbar"? Wenn viele fehlen, den
  Medienordner des Handys zusätzlich als `--media-pool` angeben.

## Schritt 4: Echter Lauf

Denselben Befehl ohne `--dry-run`, sinnvoll ergänzt um Kontextwörter:

```bash
  --asr-prompt "Lederhos, Tangel, Werbetechnik, Angebot, Rechnung, Montage"
  --title "Chatverlauf Auftrag <Projektname>"
```

Der Lauf ist unterbrechbar. Transkripte werden in `Verlauf/_cache/transkripte.json`
nach SHA-256 zwischengespeichert, ein erneuter Aufruf überspringt Fertiges und
rechnet nichts doppelt ab.

## Schritt 5: Ergebnis prüfen

```
Verlauf/
├── WhatsApp_Gesamtverlauf.pdf
├── Manifest.csv
├── Verlauf.json
└── Medien/<Chat>/<Jahr>/<MM_Monat>/<YYYY-MM-DD>/  Original .opus + .mp3
```

Kontrollen:
1. Deckblatt: Zeitraum und Nachrichtenzahl plausibel?
2. Stichprobe: eine MP3 anhören und mit dem Transkript im PDF vergleichen
3. Anlage: enthält sie alle Sprachnachrichten mit SHA-256?
4. `Manifest.csv` nach Spalte `zuordnung` filtern. `timestamp` bedeutet
   heuristisch zugeordnet, diese Fälle einzeln gegenhören.

## Regeln für diesen Auftrag

Das Ergebnis soll als Beleg taugen, deshalb gilt:

- **Nichts an den Originalen ändern.** Das Tool kopiert und konvertiert nur, die
  Quelldateien bleiben unangetastet. Exporte nicht nachbearbeiten.
- **Nichts weglassen.** Auch unpassende oder belanglose Nachrichten bleiben drin.
  Ein selektiver Auszug verliert seinen Wert als Beleg. Für einen kürzeren Auszug
  `--since` und `--until` nutzen, das ist im PDF als Zeitraum sichtbar.
- **Transkripte nicht glätten.** Sie sind maschinell erzeugt und im PDF als solche
  gekennzeichnet. Fehler dürfen sichtbar bleiben, maßgeblich ist die Audiodatei.
- **Fehlendes ausweisen.** Nicht auffindbare Sprachnachrichten stehen im PDF. Nicht
  entfernen.
- **Originale sichern.** Den Ordner `Verlauf/` samt `Medien/` vollständig
  aufbewahren, nicht nur das PDF.

## Bekannte Stolpersteine

| Symptom | Ursache und Lösung |
|---|---|
| Viele Sprachnachrichten "nicht auffindbar" | Export ohne Medien. Medienordner des Handys als `--media-pool` ergänzen |
| Falsche Datumszuordnung | Sehr kleine Exporte im US-Format. Mit `--limit 50` prüfen, im Zweifel Export mit mehr Nachrichten nutzen |
| Emojis erscheinen als `[U+1F44D]` | Farb-Emoji-Schriften sind im PDF nicht einbettbar. `--emoji name` für Klartext oder eine monochrome TTF via `--emoji-font` |
| `OPENAI_API_KEY ist nicht gesetzt` | Schlüssel exportieren oder auf `--asr faster-whisper` wechseln, das läuft lokal |
| Lauf bricht ab | Einfach erneut starten, der Cache übernimmt das Fertige |

## Wenn etwas fehlt

Das Tool ist bewusst modular. `wa_forensics/parser.py` deckt Android und iOS in
DE und EN ab. Taucht ein unbekanntes Exportformat auf, dort die Regex-Muster
erweitern und `selftest.py` um einen Fall ergänzen.
