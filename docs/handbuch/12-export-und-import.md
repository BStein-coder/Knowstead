---
title: Export und Import
icon: 📦
---

# Export und Import

<!-- toc -->

## Seiten exportieren

Über **… → Exportieren …** auf jeder Seite öffnet sich der Exportdialog:

| Format | Geeignet für |
| --- | --- |
| **PDF** | Weitergabe und Archiv – mit Firmenvorlage, Deckblatt und Inhaltsverzeichnis |
| **Word (.docx)** | Weiterbearbeiten in Word, etwa für Verträge oder Angebote |
| **Markdown** | Git, Obsidian & Co. – mit Frontmatter (Titel, Version, Stichwörter, Eigenschaften) |
| **HTML** | eigenständige, gestaltete Webseite |

- **Unterseiten einbeziehen**: Bei PDF und Word entsteht ein Dokument mit allen Unterseiten als Kapitel; bei Markdown und HTML ein ZIP mit dem Seitenbaum. Auf der Startseite eines Bereichs heißt die Option **Alle Seiten des Bereichs einbeziehen**.
- **Deckblatt** (Titel, Bereich, Stand, Version, Verantwortliche) und **Inhaltsverzeichnis** (aus Überschriften und Unterseiten, mit Seitenzahlen) lassen sich für PDF und Word einzeln abwählen. Feste Beschriftungen folgen deiner Sprache.
- **Drucken** im selben Menü nutzt den Druckdialog des Browsers; Navigation und Bedienelemente werden ausgeblendet.

### Was im PDF- und Word-Dokument landet

Überschriften, Absätze, Listen und Aufgabenlisten, Tabellen, Hinweisboxen, Zitate, Code, Bilder und Galerien, draw.io-Diagramme und Whiteboards werden übernommen. Mermaid-Diagramme und Formeln erscheinen als Quelltext, eingebettete PDFs und Dateien als Hinweis, das Aufgaben-Makro als Verweis auf die Online-Ansicht. Offene Änderungsvorschläge werden nicht übernommen. Gestaltet wird nach der **Export-Vorlage** der Administration (Logo, Farbe, Kopf- und Fußzeile).

> [!NOTE]
> Ein Dokument umfasst höchstens 300 Seiten. Es enthält nur Seiten und Bilder, die du selbst sehen darfst.

## Bereiche exportieren

In den **Bereichseinstellungen → Export & Import**:

| Format | Inhalt |
| --- | --- |
| Markdown (ZIP) | Ordnerstruktur entsprechend dem Seitenbaum, Anhänge unter `_anhaenge/`, relative Links |
| HTML-Webseite (ZIP) | statische Webseite mit Inhaltsverzeichnis – z. B. für Offline-Weitergabe |
| Knowstead-Archiv (ZIP) | vollständiges Archiv inkl. **aller Versionen**, Stichwörtern, Eigenschaften und Anhängen – zur Migration zwischen Installationen |
| **Handbuch als PDF oder Word** | alle Seiten des Bereichs in einem Dokument mit Deckblatt, Inhaltsverzeichnis, Kopf- und Fußzeile nach der Firmenvorlage |

## Importieren

In den Bereichseinstellungen lassen sich importieren:

- einzelne **Markdown-, HTML- oder Textdateien**,
- **ZIP-Archive** mit Ordnern (werden zu Seitenhierarchien, `index.md`/`README.md` werden zur Ordnerseite) und Bildern (werden zu Anhängen),
- **Knowstead-Archive** – inklusive Versionsgeschichte.

Beim Markdown-Import werden GitHub-Hinweise (`> [!NOTE]`), Aufgabenlisten, Tabellen, Mermaid-Diagramme und `<!-- toc -->` in die entsprechenden Knowstead-Makros umgewandelt. Frontmatter-Felder `title`, `labels` und `properties` werden übernommen.

Ein Knowstead-Archiv kann auch als **neuer Bereich** eingespielt werden: Administration → Bereiche → „Knowstead-Archiv importieren“.

## Aus einem anderen Wiki umziehen

Unter **Bereichseinstellungen → Export & Import → Aus anderem Wiki übernehmen** holst du Inhalte aus **Confluence**, **MediaWiki**, **DokuWiki** oder **XWiki** nach Knowstead – mit Seitenhierarchie, Formatierungen, Tabellen, Bildern und Dateien.

| Quelle | Was du hochlädst |
| --- | --- |
| **MediaWiki** | die XML-Datei aus *Spezial:Exportieren* (oder `dumpBackup.php`); mit Bildern als ZIP zusammen mit dem Ordner `images` |
| **DokuWiki** | den Ordner `data` als ZIP – mit `pages` und `media`, für die Versionsgeschichte auch `attic` und `meta` |
| **XWiki** | das XAR-Paket aus *Administration → Inhalt → Export* |
| **Confluence** | den Bereichsexport als ZIP – *Bereichseinstellungen → Bereich exportieren* als **XML** (empfohlen: mit Seitenbaum, Anhängen, Stichwörtern und Versionen) oder als **HTML** |

So gehst du vor:

1. Optional eine **Zielseite** wählen, unter der die importierten Seiten landen – sonst entstehen sie auf oberster Ebene.
2. **Quelle** auf *Automatisch erkennen* lassen oder festlegen.
3. Auf Wunsch **Versionsgeschichte übernehmen** (bis zu 50 Versionen je Seite).
4. **Datei wählen und importieren**. Der Import läuft im Hintergrund – du kannst die Seite verlassen und wirst benachrichtigt, wenn er fertig ist.

**Wie groß darf es sein?** Eine Datei bis 2 GB, ein Archiv entpackt bis 8 GB mit höchstens 100 000 Dateien (ein einzelner Anhang darin bis 512 MB). Knowstead liest das Archiv Stück für Stück von der Platte des Servers – auch ein großes Wiki braucht deshalb keinen großen Arbeitsspeicher, wohl aber so viel freien Speicherplatz, wie das Archiv groß ist. Ist das Archiv größer, teile den Export nach Bereichen oder Namensräumen auf.

Übernommen werden:

- **Hierarchie**: Confluence-Seitenbaum, MediaWiki-Unterseiten (`Handbuch/Installation`), DokuWiki-Namensräume und verschachtelte XWiki-Seiten; Ebenen ohne eigene Seite werden zu Ordnerseiten.
- **Confluence-Makros**: Info-, Hinweis-, Warn- und Tipp-Boxen werden zu Hinweisboxen, Code-Makros zu Codeblöcken, Aufgabenlisten zu Checklisten, Seitenverweise zu internen Links; nicht übertragbare Makros erscheinen als Vermerk im Text.
- **Inhalte**: Überschriften, Formatierungen, Listen, Tabellen, Code, Hinweisboxen und interne Verweise.
- **Dateien** als Anhänge der Seiten, **Kategorien** bzw. **Tags** als Stichwörter.

Am Ende zeigt ein **Bericht**, wie viele Seiten, Dateien und Versionen übernommen wurden – und welche Verweise auf Seiten zeigen, die nicht im Import enthalten waren (sie sind grau markiert), sowie fehlende Dateien.

> [!TIP]
> Einen großen Umzug zuerst in einem Test-Bereich ausprobieren. Vorlagen (MediaWiki) und Skript-Makros (XWiki) lassen sich nicht übertragen – Hinweis-Vorlagen werden zu Hinweisboxen, andere erscheinen als Vermerk im Text und lassen sich danach gezielt nacharbeiten.
