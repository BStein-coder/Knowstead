---
title: Dateien, PDF und Diagramme
icon: 📎
labels: [dateien, pdf, drawio, whiteboard]
---

# Dateien, PDF und Diagramme

<!-- toc -->

## Dateien hochladen

Dateien gehören direkt zur Seite, auf der sie gebraucht werden:

- **Ziehen und ablegen**: Datei aus dem Explorer in den Editor ziehen – sie landet an der Stelle, an der du loslässt.
- **Werkzeugleiste**: Büroklammer-Symbol **Datei** anklicken und eine oder mehrere Dateien wählen.
- **Slash-Menü**: `/pdf` fügt das Makro **PDF / Office anzeigen** ein, in dem du eine Datei auswählen oder direkt hochladen kannst.

Knowstead entscheidet selbst, wie die Datei erscheint:

| Datei | Darstellung im Beitrag |
| --- | --- |
| Bilder | als Bild (mehrere Bilder am besten als **Galerie**) |
| PDF | als **PDF-Betrachter** mit Blättern, Zoom, Vollbild und Download |
| Word, Excel, PowerPoint, Visio, OpenDocument | als **Dateikarte** mit Vorschau (sofern eingerichtet) und Download |
| Video und Ton | als **Dateikarte** mit **Abspielen** – der Browser spielt sie im Fenster ab |
| alle anderen | als **Dateikarte** mit Download |

Jede hochgeladene Datei erscheint zusätzlich unter **Anhänge** am Ende der Seite – dort gibt es Versionen, Kommentare und den Papierkorb für Dateien.

> [!NOTE]
> Welche Dateiendungen erlaubt sind und wie groß Dateien sein dürfen, legt die Administration fest.

## Video und Ton

Video- und Tondateien (MP4, WebM, MP3, WAV, M4A und Ähnliches) bekommen auf der Dateikarte den Knopf
**Abspielen**. Knowstead öffnet ein Fenster mit den gewohnten Bedienelementen des Browsers: abspielen,
anhalten, **springen**, Lautstärke und Vollbild.

Der Server liefert solche Dateien in Bereichen aus. Deshalb beginnt die Wiedergabe sofort, auch bei
einer großen Aufzeichnung, das Springen im Zeitstrahl funktioniert, und ein abgebrochener Download
setzt fort statt neu zu beginnen.

> [!NOTE]
> Welche Formate abspielbar sind, entscheidet der Browser. Kann er ein Format nicht, steht das im
> Fenster – die Datei lässt sich weiterhin herunterladen.

## PDF-Betrachter

Der PDF-Betrachter zeigt Dokumente direkt im Beitrag – ohne Download und ohne Browser-Erweiterung:

- **Blättern** mit den Pfeilen oder durch Eingabe der Seitenzahl,
- **Zoomen** mit `+`/`−`, **Seitenbreite** passt das Dokument an die Spalte an,
- **Vollbild** für längere Dokumente, **Herunterladen** für die Originaldatei.

Im Editor stellst du über das Zahnrad ein, welches PDF angezeigt wird und wie hoch der Betrachter ist. Eine Dateikarte eines PDFs lässt sich mit **Einbetten** in einen Betrachter umwandeln.

## Office- und Visio-Dateien

PowerPoint (`.pptx`, `.ppt`), Word (`.docx`), Excel (`.xlsx`), Visio (`.vsdx`, `.vsd`) und OpenDocument-Dateien zeigt Knowstead als **Vorschau** an, wenn auf dem Server LibreOffice eingerichtet ist. Die Datei wird dann einmalig in ein PDF umgewandelt und im PDF-Betrachter geöffnet; das Original bleibt unverändert.

Ist die Vorschau nicht eingerichtet, bietet die Dateikarte den Download an.

> [!TIP]
> Präsentationen, die dauerhaft in einem Beitrag sichtbar sein sollen, kannst du auch als PDF exportieren und hochladen – dann blättert jeder direkt im Beitrag.

## draw.io-Diagramme

Mit draw.io zeichnest du Prozesse, Netzwerkpläne, Organigramme oder Architekturskizzen direkt in Knowstead:

1. Im Editor `/drawio` tippen und **draw.io-Diagramm** wählen.
2. **Diagramm bearbeiten** öffnet den Editor im Vollbild.
3. Zeichnen, dann **Speichern** (Editor bleibt offen) oder **Speichern & Beenden**.

Das Diagramm wird als Grafik in der Seite gespeichert und bleibt jederzeit bearbeitbar. Da Diagramme Teil des Seiteninhalts sind, erscheinen Änderungen in der **Versionsgeschichte** und lassen sich wiederherstellen.

> [!NOTE]
> Standardmäßig lädt Knowstead den Editor von `embed.diagrams.net`. Der Editor läuft in deinem Browser, gespeichert wird das Diagramm ausschließlich in Knowstead. Die Administration kann eine eigene draw.io-Installation hinterlegen – dann funktioniert der Editor auch ganz ohne Internetzugang.

Für Diagramme, die als Text beschrieben werden (Flussdiagramme, Sequenzen, Gantt), gibt es weiterhin das **Mermaid-Diagramm** – siehe Kapitel **Editor und Makros**.

## Whiteboard

Das **Whiteboard** ist die freie Skizzenfläche neben draw.io – ideal für Ideensammlungen, Workshop-Ergebnisse, grobe Abläufe oder eine schnelle Zeichnung, die nicht exakt aussehen muss:

1. Im Editor `/whiteboard` tippen und **Whiteboard** wählen.
2. **Whiteboard öffnen** startet die Zeichenfläche im Vollbild.
3. Zeichnen: Freihand, Rechtecke, Kreise, Pfeile, Linien, Text und Bilder – alles im Handzeichnungs-Stil, frei verschieb- und gruppierbar.
4. Optional einen **Titel** vergeben, dann **Speichern & schließen**.

Die Skizze erscheint als Grafik in der Seite und bleibt bearbeitbar. Änderungen stehen in der **Versionsgeschichte**, beim Export nach PDF oder Word wird das Whiteboard als Grafik übernommen.

> [!TIP]
> **draw.io** oder **Whiteboard**? Für saubere Prozesse, Netzwerkpläne und Organigramme mit exakten Formen ist draw.io das richtige Werkzeug. Für schnelle, lockere Skizzen ist das Whiteboard schneller.

> [!NOTE]
> Das Whiteboard läuft vollständig in Knowstead – ohne externe Dienste und auch ohne Internetzugang. Eine Skizze darf bis zu 4 MB groß sein; große Bilder vorher verkleinern.
