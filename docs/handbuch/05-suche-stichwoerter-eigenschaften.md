---
title: Suche, Stichwörter und Eigenschaften
icon: 🔎
---

# Suche, Stichwörter und Eigenschaften

<!-- toc -->

## Volltextsuche

Die Suche durchsucht Titel, Inhalte und Stichwörter aller Seiten, die du sehen darfst. Treffer werden nach Relevanz sortiert, Fundstellen hervorgehoben. Rechts filterst du nach Bereich, Stichwort und Seitentyp.

### Suche in Anhängen

Knowstead durchsucht auch den **Inhalt hochgeladener Dateien**. Passende Anhänge erscheinen rechts neben den Seitentreffern – mit Textauszug und dem Hinweis **im Inhalt**, wenn der Begriff in der Datei selbst vorkommt.

| Dateien | Durchsucht |
| --- | --- |
| PDF | der enthaltene Text; eingescannte Seiten, wenn die Administration die Texterkennung (OCR) eingerichtet hat |
| Bilder (PNG, JPEG, TIFF, BMP, GIF, WebP) | erkannter Text, wenn die Texterkennung eingerichtet ist |
| Word, Excel, PowerPoint, Visio | Text, Tabellenblätter, Folien und Notizen |
| OpenDocument, RTF, HTML, Text, CSV | der Text |
| ältere Office-Formate (`.doc`, `.xls`, `.ppt`) | wenn die Administration die Office-Vorschau eingerichtet hat |

Neue Dateien sind nach wenigen Sekunden auffindbar. Du findest nur Anhänge von Seiten, die du lesen darfst, und immer die neueste Version einer Datei.

### Aufgaben und ihr Chat

Neben Seiten und Anhängen zeigt die Suche passende **Aufgaben** aus den Plänen deiner Bereiche – gefunden über Titel, Beschreibung, Stichwörter und die **Nachrichten im Chat** der Aufgabe. Groß- und Kleinschreibung spielt keine Rolle, auch nicht bei Umlauten („überstunden“ findet „Überstunden“). Steckt der Begriff in einer Nachricht, steht unter dem Treffer **Im Chat** mit dem Namen der Person und dem Ausschnitt; ein Klick öffnet die Aufgabe und springt zu dieser Nachricht. Gelöschte Nachrichten und Aufgaben im Papierkorb erscheinen nicht.

### Suchsyntax

| Eingabe | Bedeutung |
| --- | --- |
| `datenbank backup` | Seiten, die beide Begriffe enthalten (Wortanfänge genügen) |
| `"backup und restore"` | genaue Phrase |
| `backup -test` | „backup“, aber nicht „test“ |
| `backup ODER sicherung` | einer der Begriffe |
| `space:DEV` | nur im Bereich DEV |
| `label:anleitung` | nur Seiten mit Stichwort „anleitung“ |
| `author:max` | erstellt oder zuletzt geändert von Benutzer „max“ |
| `type:markdown` | nur Markdown-Seiten (`text`, `markdown`, `code`) |
| `in:title release` | nur im Titel suchen |
| `#Status` | Seiten mit der Eigenschaft „Status“ |
| `#Status=erledigt` | Eigenschaft mit bestimmtem Wert |
| `#Priorität>2` | Zahlenvergleich (`>`, `<`, `>=`, `<=`, `!=`) |
| `#Verantwortlich~anna` | Wert enthält „anna“ |

Filter lassen sich frei kombinieren: `label:runbook space:OPS #Kritikalität=hoch datenbank`.

## Stichwörter (Labels)

Stichwörter ordnen Seiten quer über Bereiche hinweg. Du vergibst sie unter dem Seitentitel (Stift-Symbol) oder direkt beim Bearbeiten unter dem Titel. Ein Klick auf ein Stichwort zeigt alle Seiten mit diesem Stichwort. Stichwörter werden kleingeschrieben, Leerzeichen werden zu Bindestrichen.

Die Seite **Stichwörter** in der linken Navigation zeigt alle Stichwörter als Wolke oder Liste mit der Anzahl der Seiten – auf Wunsch nur für einen Bereich. Administratoren können dort Stichwörter **umbenennen** (gibt es den neuen Namen schon, werden beide **zusammengeführt**) und **löschen**; die Suche wird automatisch aktualisiert.

> [!TIP]
> Ist der KI-Assistent eingerichtet, schlägt er über **… → KI-Assistent → Stichwörter** passende Stichwörter vor, die du mit einem Klick übernimmst.

## Eigenschaften

Eigenschaften sind strukturierte **Schlüssel-Wert-Paare** einer Seite – zum Beispiel `Status = in Arbeit`, `Verantwortlich = Anna`, `Fällig = 2026-10-01`. Sie erscheinen als Tabelle unter dem Inhalt und können einen Typ haben (Text, Zahl, Datum, URL, Status, Ja/Nein).

Der Makro **Eigenschaften-Bericht** fasst die Eigenschaften mehrerer Seiten zu einer Tabelle zusammen – etwa alle Projekte unter „Projekte“ mit Status und Verantwortlichen. So entsteht ein kleines, immer aktuelles Dashboard ohne Tabellenpflege.

> [!TIP]
> Vorlagen können Eigenschaften vorgeben. Die Vorlage „Projektsteckbrief“ legt z. B. Status, Verantwortlich, Start und Ende an.
